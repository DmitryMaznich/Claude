const mqtt = require('mqtt');
const EventEmitter = require('events');

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
    }

    connect(brokerUrl, options) {
        if (!brokerUrl) {
            console.log('⚠️ MQTT Broker URL is not defined. MQTT client will not connect.');
            return;
        }

        console.log(`Connecting to MQTT broker at ${brokerUrl}...`);

        try {
            this.client = mqtt.connect(brokerUrl, options);

            this.client.on('connect', () => {
                console.log('✅ Successfully connected to cloud MQTT broker');
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
                try {
                    const data = JSON.parse(message.toString());
                    this.handleDeviceData(topic, data);
                } catch (e) {
                    // Ignore non-JSON messages
                }
            });

            this.client.on('error', (err) => {
                console.error('MQTT Client Error:', err);
            });

            this.client.on('offline', () => {
                console.log('MQTT Client offline');
            });

        } catch (error) {
            console.error('Failed to initialize MQTT client:', error);
        }
    }

    handleDeviceData(topic, data) {
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
                this.emit('machineStarted', machine);
            }
        }
        // If power < 5W -> Machine might be stopped
        else if (currentPower < 5 && machine.isRunning) {
            // Don't stop immediately, start a 3-minute timer to ignore short operational pauses
            if (!this.stopTimers[channel]) {
                const STOP_DELAY_MS = 3 * 60 * 1000; // 3 minutes

                this.stopTimers[channel] = setTimeout(() => {
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
}

module.exports = new MqttClient();
