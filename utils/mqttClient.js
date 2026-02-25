const mqtt = require('mqtt');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const STATS_FILE = path.join(__dirname, '../data/stats.json');

class MqttClient extends EventEmitter {
    constructor() {
        super();
        this.client = null;

        // Structure for storing machines (Galjevica location)
        // Note: Dryers come in physical pairs on one power circuit.
        // Physical Refoss channel 5 → virtual dryers 5 and 6 (Pair A)
        // Physical Refoss channel 6 → virtual dryers 7 and 8 (Pair B)
        // We use current (Amps) to determine if 1 or 2 dryers in a pair are running.
        this.machines = {
            1: { id: 1, name: "Pralnik 10kg #1", power: 0, isRunning: false, startedAt: null, lastStartedAt: null },
            2: { id: 2, name: "Pralnik 10kg #2", power: 0, isRunning: false, startedAt: null, lastStartedAt: null },
            3: { id: 3, name: "Pralnik 10kg #3", power: 0, isRunning: false, startedAt: null, lastStartedAt: null },
            4: { id: 4, name: "Pralnik 18kg", power: 0, isRunning: false, startedAt: null, lastStartedAt: null },
            5: { id: 5, name: "Sušilnik A1", power: 0, isRunning: false, startedAt: null, lastStartedAt: null },
            6: { id: 6, name: "Sušilnik A2", power: 0, isRunning: false, startedAt: null, lastStartedAt: null },
            7: { id: 7, name: "Sušilnik B1", power: 0, isRunning: false, startedAt: null, lastStartedAt: null },
            8: { id: 8, name: "Sušilnik B2", power: 0, isRunning: false, startedAt: null, lastStartedAt: null }
        };

        // Maps physical Refoss channel → [virtualId1, virtualId2]
        // When current >= DRYER_DUAL_CURRENT_THRESHOLD → both virtual dryers are running
        // When current < threshold but power > startThreshold → only first virtual dryer is running
        this.DRYER_CHANNEL_MAP = {
            5: [5, 6], // Refoss channel 5 → Sušilnik A1 (id:5) and Sušilnik A2 (id:6)
            6: [7, 8]  // Refoss channel 6 → Sušilnik B1 (id:7) and Sušilnik B2 (id:8)
        };

        // If measured current on a dryer channel exceeds this value, both dryers in the pair are running
        this.DRYER_DUAL_CURRENT_THRESHOLD = 3.5; // Amperes

        // Timers to avoid false positives on short power drops (e.g. during a wash cycle pause)
        this.stopTimers = {};

        // Daily stats: { "2026-02-23": { 1: { starts: 3, runtimeMs: 7200000 }, ... } }
        this.stats = this._loadStats();

        // Debug tracking
        this.debug = {
            isConnected: false,
            connectedAt: null,
            lastError: null,
            lastErrorAt: null,
            messagesReceived: 0,
            lastMessageAt: null,
            lastMessageTopic: null,
            lastMessagePayload: null,
            brokerUrl: null
        };
    }

    _today() {
        return new Date().toISOString().slice(0, 10); // "2026-02-23"
    }

    _loadStats() {
        try {
            if (fs.existsSync(STATS_FILE)) {
                const content = fs.readFileSync(STATS_FILE, 'utf8').trim();
                if (content.length > 0) {
                    return JSON.parse(content);
                }
            }
        } catch (e) {
            console.error('[Stats] Failed to load stats file:', e.message);
        }
        return {};
    }

    _saveStats() {
        try {
            const dir = path.dirname(STATS_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(STATS_FILE, JSON.stringify(this.stats, null, 2));
        } catch (e) {
            console.error('[Stats] Failed to save stats file:', e.message);
        }
    }

    _ensureDayEntry(date, channel) {
        if (!this.stats[date]) this.stats[date] = {};
        if (!this.stats[date][channel]) {
            this.stats[date][channel] = { starts: 0, runtimeMs: 0 };
        }
    }

    connect(brokerUrl, options) {
        if (!brokerUrl) {
            console.log('⚠️ MQTT Broker URL is not defined. MQTT client will not connect.');
            return;
        }

        this.debug.brokerUrl = brokerUrl;
        console.log(`Connecting to MQTT broker at ${brokerUrl}...`);

        try {
            this.client = mqtt.connect(brokerUrl, options);

            this.client.on('connect', () => {
                console.log('✅ Successfully connected to cloud MQTT broker');
                this.debug.isConnected = true;
                this.debug.connectedAt = new Date();
                // Subscribe to all topics to capture Refoss EM06P messages
                this.client.subscribe('#', (err) => {
                    if (err) {
                        console.error('MQTT Subscription error:', err);
                    } else {
                        console.log('📡 Subscribed to all topics for Refoss EM06P');
                    }
                });
            });

            this.client.on('message', (topic, message) => {
                const raw = message.toString();
                this.debug.messagesReceived++;
                this.debug.lastMessageAt = new Date();
                this.debug.lastMessageTopic = topic;
                this.debug.lastMessagePayload = raw.length > 500 ? raw.substring(0, 500) + '...' : raw;
                try {
                    const data = JSON.parse(raw);
                    this.handleDeviceData(topic, data);
                } catch (e) {
                    // Ignore non-JSON messages
                }
            });

            this.client.on('error', (err) => {
                console.error('MQTT Client Error:', err);
                this.debug.isConnected = false;
                this.debug.lastError = err.message;
                this.debug.lastErrorAt = new Date();
            });

            this.client.on('offline', () => {
                console.log('MQTT Client offline');
                this.debug.isConnected = false;
            });

            this.client.on('reconnect', () => {
                console.log('MQTT Client reconnecting...');
            });

        } catch (error) {
            console.error('Failed to initialize MQTT client:', error);
        }
    }

    handleDeviceData(topic, data) {
        // Handle Refoss EM06P specific payload format with 'method': 'NotifyStatus'
        if (data.method === 'NotifyStatus' && data.params) {
            for (let key in data.params) {
                if (key.startsWith('em:')) {
                    const channelStr = key.split(':')[1];
                    const channel = parseInt(channelStr, 10);
                    const channelData = data.params[key];
                    const power = channelData.power;
                    const current = channelData.current; // Amps — used to detect dryer pairs
                    console.log(`[MQTT] em:${channelStr} → channel=${channel}, power=${power}W, current=${current}A`);
                    if (!isNaN(channel) && power !== undefined) {
                        if (this.DRYER_CHANNEL_MAP[channel]) {
                            // Physical dryer pair channel — use current-based logic
                            this.updateDryerPair(channel, power, current);
                        } else {
                            this.updateMachineStatus(channel, power);
                        }
                    }
                }
            }
            return;
        }

        // Handle standard Refoss structured payload
        let channel = data.channel || data.Channel;
        let power = data.power || data.Power || data.active_power || data.ActivePower;

        // If array of channels is sent:
        if (data.channels && Array.isArray(data.channels)) {
            data.channels.forEach(ch => {
                this.updateMachineStatus(ch.channel, ch.power);
            });
            return;
        }

        if (channel !== undefined && power !== undefined) {
            this.updateMachineStatus(channel, power);
        } else if (data.energy && Array.isArray(data.energy)) {
            data.energy.forEach((item, index) => {
                this.updateMachineStatus(index + 1, item.power !== undefined ? item.power : 0);
            });
        }
    }

    // Start or stop a single virtual machine, with a 1-minute debounce before stopping
    _setMachineRunning(id, running, currentPower) {
        const machine = this.machines[id];
        if (!machine) return;

        if (running) {
            if (this.stopTimers[id]) {
                clearTimeout(this.stopTimers[id]);
                this.stopTimers[id] = null;
            }
            if (!machine.isRunning) {
                machine.isRunning = true;
                machine.startedAt = new Date();
                machine.lastStartedAt = machine.startedAt;
                console.log(`📠 [MQTT] ${machine.name} STARTED at ${currentPower}W`);

                const today = this._today();
                this._ensureDayEntry(today, id);
                this.stats[today][id].starts++;
                this._saveStats();

                this.emit('machineStarted', machine);
            }
        } else {
            if (machine.isRunning && !this.stopTimers[id]) {
                const startedAt = machine.startedAt;
                this.stopTimers[id] = setTimeout(() => {
                    if (startedAt) {
                        const runtimeMs = Date.now() - startedAt.getTime();
                        const today = this._today();
                        this._ensureDayEntry(today, id);
                        this.stats[today][id].runtimeMs += runtimeMs;
                        this._saveStats();
                    }
                    machine.isRunning = false;
                    machine.startedAt = null;
                    console.log(`📠 [MQTT] ${machine.name} STOPPED`);
                    this.emit('machineStopped', machine);
                    this.stopTimers[id] = null;
                }, 60 * 1000);
            }
        }
    }

    // Handle a physical dryer pair channel (channels 5 or 6 on Refoss).
    // Uses current threshold (3.5A) to decide if 1 or 2 dryers are running.
    updateDryerPair(physicalChannel, power, current) {
        const [id1, id2] = this.DRYER_CHANNEL_MAP[physicalChannel];
        const START_POWER = 100; // Watts — both machines share one circuit, so even 1 dryer = >100W
        const STOP_POWER = 50;  // Watts — idle gas dryer baseline

        // Update the shared power reading on the first virtual machine for visibility
        if (this.machines[id1]) this.machines[id1].power = power;
        if (this.machines[id2]) this.machines[id2].power = power;

        const anyRunning = power > START_POWER;
        const bothRunning = anyRunning && (current !== undefined) && (current >= this.DRYER_DUAL_CURRENT_THRESHOLD);
        const stopped = power < STOP_POWER;

        console.log(`[MQTT] Dryer pair ch${physicalChannel}: power=${power}W, current=${current}A → bothRunning=${bothRunning}, anyRunning=${anyRunning}`);

        this._setMachineRunning(id1, anyRunning, power);
        this._setMachineRunning(id2, bothRunning, power);

        if (stopped) {
            this._setMachineRunning(id1, false, power);
            this._setMachineRunning(id2, false, power);
        }
    }

    updateMachineStatus(channel, currentPower) {
        const machine = this.machines[channel];
        if (!machine) return;

        machine.power = currentPower;

        // Washers only (dryers are handled by updateDryerPair)
        const START_POWER = 10; // Watts
        const STOP_POWER = 5;  // Watts

        if (currentPower > START_POWER) {
            this._setMachineRunning(channel, true, currentPower);
        } else if (currentPower < STOP_POWER) {
            this._setMachineRunning(channel, false, currentPower);
        }
    }

    getMachines() {
        return this.machines;
    }

    getStats(days = 30) {
        const result = {};
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);

        for (const date of Object.keys(this.stats).sort()) {
            if (new Date(date) >= cutoff) {
                result[date] = {};
                for (const [channel, data] of Object.entries(this.stats[date])) {
                    const machine = this.machines[channel];
                    result[date][channel] = {
                        name: machine ? machine.name : `Channel ${channel}`,
                        starts: data.starts,
                        runtimeMs: data.runtimeMs,
                        runtimeHuman: this._formatDuration(data.runtimeMs)
                    };
                }
            }
        }
        return result;
    }

    _formatDuration(ms) {
        if (!ms) return '0m';
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    getDebugStatus() {
        return {
            ...this.debug,
            clientState: this.client ? this.client.connected ? 'connected' : 'disconnected' : 'not initialized'
        };
    }
}

module.exports = new MqttClient();
