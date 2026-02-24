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
        this.machines = {
            1: { id: 1, name: "Pralnik 9kg", power: 0, isRunning: false, startedAt: null },
            2: { id: 2, name: "Pralnik 9kg (+Ozon)", power: 0, isRunning: false, startedAt: null },
            3: { id: 3, name: "Pralnik 15kg (+Ozon)", power: 0, isRunning: false, startedAt: null },
            4: { id: 4, name: "Pralnik 20kg", power: 0, isRunning: false, startedAt: null },
            5: { id: 5, name: "Sušilnik (blok 1)", power: 0, isRunning: false, startedAt: null },
            6: { id: 6, name: "Sušilnik (blok 2)", power: 0, isRunning: false, startedAt: null }
        };

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
                return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
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
                    const channel = parseInt(channelStr, 10); // Refoss sends em:1..em:6, machines are keyed 1..6
                    const power = data.params[key].power;
                    console.log(`[MQTT] em:${channelStr} → channel=${channel}, power=${power}`);
                    if (!isNaN(channel) && power !== undefined) {
                        this.updateMachineStatus(channel, power);
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

    updateMachineStatus(channel, currentPower) {
        const machine = this.machines[channel];
        if (!machine) return;

        machine.power = currentPower;

        // Power is in Watts (confirmed: V × I × pf matches the power field value)
        // If power > 10W -> Machine is running
        if (currentPower > 10) {
            // Cancel any pending stop timers
            if (this.stopTimers[channel]) {
                clearTimeout(this.stopTimers[channel]);
                this.stopTimers[channel] = null;
            }

            if (!machine.isRunning) {
                machine.isRunning = true;
                machine.startedAt = new Date();
                console.log(`📠 [MQTT] ${machine.name} STARTED at ${currentPower}W`);

                // Record start in daily stats
                const today = this._today();
                this._ensureDayEntry(today, channel);
                this.stats[today][channel].starts++;
                this._saveStats();

                this.emit('machineStarted', machine);
            }
        }
        // If power < 5W -> Machine might be stopped
        else if (currentPower < 5 && machine.isRunning) {
            // Don't stop immediately, start a 3-minute timer to ignore short operational pauses
            if (!this.stopTimers[channel]) {
                const STOP_DELAY_MS = 3 * 60 * 1000; // 3 minutes
                const startedAt = machine.startedAt;

                this.stopTimers[channel] = setTimeout(() => {
                    // Record runtime in daily stats
                    if (startedAt) {
                        const runtimeMs = Date.now() - startedAt.getTime();
                        const today = this._today();
                        this._ensureDayEntry(today, channel);
                        this.stats[today][channel].runtimeMs += runtimeMs;
                        this._saveStats();
                    }

                    machine.isRunning = false;
                    machine.startedAt = null;
                    console.log(`📠 [MQTT] ${machine.name} STOPPED (power=${currentPower}W maintained for 3 mins)`);
                    this.emit('machineStopped', machine);
                    this.stopTimers[channel] = null;
                }, STOP_DELAY_MS);
            }
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
