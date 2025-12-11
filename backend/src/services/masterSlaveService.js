/**
 * Master-Slave Service
 * Manages master drone designation and data aggregation from slave drones
 */

const db = require('../database/connection');

class MasterSlaveService {
    /**
     * Set master drone
     * @param {string} masterUAVId - Master UAV ID
     * @returns {Object} Master drone info
     */
    async setMasterDrone(masterUAVId) {
        const timestamp = new Date().toISOString();
        
        // Store master drone info in memory (can be persisted to DB if needed)
        // For now, we'll use a simple in-memory store
        const query = `
            INSERT OR REPLACE INTO master_drone (
                id, master_uav_id, assigned_at, updated_at
            ) VALUES (1, ?, ?, ?)
        `;
        
        try {
            await db.run(query, [masterUAVId, timestamp, timestamp]);
            console.log(`👑 Master drone set to: ${masterUAVId}`);
            
            return {
                masterUAVId,
                assignedAt: timestamp,
                updatedAt: timestamp
            };
        } catch (error) {
            // If table doesn't exist, create it and retry
            if (error.message.includes('no such table')) {
                await this.createMasterDroneTable();
                await db.run(query, [masterUAVId, timestamp, timestamp]);
                return {
                    masterUAVId,
                    assignedAt: timestamp,
                    updatedAt: timestamp
                };
            }
            throw error;
        }
    }

    /**
     * Get current master drone
     * @returns {Object|null} Master drone info or null
     */
    async getMasterDrone() {
        try {
            const query = 'SELECT * FROM master_drone WHERE id = 1';
            const result = await db.get(query);
            
            if (result) {
                return {
                    masterUAVId: result.master_uav_id,
                    assignedAt: result.assigned_at,
                    updatedAt: result.updated_at
                };
            }
            return null;
        } catch (error) {
            // Table doesn't exist yet
            if (error.message.includes('no such table')) {
                await this.createMasterDroneTable();
                return null;
            }
            throw error;
        }
    }

    /**
     * Store data from slave drone to master
     * @param {Object} slaveData - Data from slave drone
     * @returns {Object} Stored data record
     */
    async storeSlaveData(slaveData) {
        const {
            slaveUAVId,
            masterUAVId,
            location,
            batteryLevel,
            isacMode,
            signalStrength,
            dataRate,
            detections = [],
            timestamp = new Date().toISOString()
        } = slaveData;

        // Store slave data transmission
        const query = `
            INSERT INTO slave_data_transmissions (
                slave_uav_id, master_uav_id, lat, lng, altitude,
                battery_level, isac_mode, signal_strength, data_rate,
                detections_count, timestamp, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const params = [
            slaveUAVId,
            masterUAVId,
            location?.lat || 0,
            location?.lng || 0,
            location?.altitude || 0,
            batteryLevel,
            isacMode,
            signalStrength,
            dataRate,
            detections.length,
            timestamp,
            new Date().toISOString()
        ];

        try {
            await db.run(query, params);
            
            console.log(`📤 Slave ${slaveUAVId} sent data to master ${masterUAVId}`);
            
            return {
                slaveUAVId,
                masterUAVId,
                timestamp,
                detectionsCount: detections.length
            };
        } catch (error) {
            if (error.message.includes('no such table')) {
                await this.createSlaveDataTable();
                await db.run(query, params);
                return {
                    slaveUAVId,
                    masterUAVId,
                    timestamp,
                    detectionsCount: detections.length
                };
            }
            throw error;
        }
    }

    /**
     * Get aggregated data from all slaves for master
     * @param {string} masterUAVId - Master UAV ID
     * @param {number} limit - Number of recent transmissions
     * @returns {Object} Aggregated data from all slaves
     */
    async getAggregatedData(masterUAVId, limit = 100) {
        const query = `
            SELECT 
                slave_uav_id,
                lat, lng, altitude,
                battery_level,
                isac_mode,
                signal_strength,
                data_rate,
                detections_count,
                timestamp
            FROM slave_data_transmissions
            WHERE master_uav_id = ?
            ORDER BY timestamp DESC
            LIMIT ?
        `;

        try {
            const transmissions = await db.all(query, [masterUAVId, limit]);
            
            // Aggregate data by slave
            const aggregated = {};
            let totalDetections = 0;
            let totalTransmissions = 0;

            transmissions.forEach(transmission => {
                const slaveId = transmission.slave_uav_id;
                
                if (!aggregated[slaveId]) {
                    aggregated[slaveId] = {
                        slaveUAVId: slaveId,
                        transmissions: [],
                        totalDetections: 0,
                        latestLocation: null,
                        latestBattery: null,
                        latestISAC: null,
                        lastUpdate: null
                    };
                }

                aggregated[slaveId].transmissions.push({
                    location: {
                        lat: transmission.lat,
                        lng: transmission.lng,
                        altitude: transmission.altitude
                    },
                    batteryLevel: transmission.battery_level,
                    isacMode: transmission.isac_mode,
                    signalStrength: transmission.signal_strength,
                    dataRate: transmission.data_rate,
                    detectionsCount: transmission.detections_count,
                    timestamp: transmission.timestamp
                });

                aggregated[slaveId].totalDetections += transmission.detections_count;
                totalDetections += transmission.detections_count;
                totalTransmissions++;

                // Update latest values
                if (!aggregated[slaveId].lastUpdate || 
                    transmission.timestamp > aggregated[slaveId].lastUpdate) {
                    aggregated[slaveId].latestLocation = {
                        lat: transmission.lat,
                        lng: transmission.lng,
                        altitude: transmission.altitude
                    };
                    aggregated[slaveId].latestBattery = transmission.battery_level;
                    aggregated[slaveId].latestISAC = {
                        mode: transmission.isac_mode,
                        signalStrength: transmission.signal_strength,
                        dataRate: transmission.data_rate
                    };
                    aggregated[slaveId].lastUpdate = transmission.timestamp;
                }
            });

            return {
                masterUAVId,
                totalSlaves: Object.keys(aggregated).length,
                totalTransmissions,
                totalDetections,
                slaves: Object.values(aggregated),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            if (error.message.includes('no such table')) {
                await this.createSlaveDataTable();
                return {
                    masterUAVId,
                    totalSlaves: 0,
                    totalTransmissions: 0,
                    totalDetections: 0,
                    slaves: [],
                    timestamp: new Date().toISOString()
                };
            }
            throw error;
        }
    }

    /**
     * Get all slave drones for a master
     * @param {string} masterUAVId - Master UAV ID
     * @returns {Array} List of slave UAV IDs
     */
    async getSlaveDrones(masterUAVId) {
        const query = `
            SELECT DISTINCT slave_uav_id
            FROM slave_data_transmissions
            WHERE master_uav_id = ?
            ORDER BY MAX(timestamp) DESC
        `;

        try {
            const slaves = await db.all(query, [masterUAVId]);
            return slaves.map(s => s.slave_uav_id);
        } catch (error) {
            if (error.message.includes('no such table')) {
                await this.createSlaveDataTable();
                return [];
            }
            throw error;
        }
    }

    /**
     * Create master_drone table if it doesn't exist
     */
    async createMasterDroneTable() {
        const query = `
            CREATE TABLE IF NOT EXISTS master_drone (
                id INTEGER PRIMARY KEY,
                master_uav_id TEXT NOT NULL,
                assigned_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        `;
        await db.run(query);
        console.log('✅ Created master_drone table');
    }

    /**
     * Create slave_data_transmissions table if it doesn't exist
     */
    async createSlaveDataTable() {
        const query = `
            CREATE TABLE IF NOT EXISTS slave_data_transmissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slave_uav_id TEXT NOT NULL,
                master_uav_id TEXT NOT NULL,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                altitude REAL NOT NULL,
                battery_level REAL,
                isac_mode TEXT,
                signal_strength REAL,
                data_rate REAL,
                detections_count INTEGER DEFAULT 0,
                timestamp TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        `;
        await db.run(query);
        
        // Create indexes
        await db.run('CREATE INDEX IF NOT EXISTS idx_slave_master ON slave_data_transmissions(master_uav_id)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_slave_id ON slave_data_transmissions(slave_uav_id)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_slave_timestamp ON slave_data_transmissions(timestamp)');
        
        console.log('✅ Created slave_data_transmissions table');
    }
}

module.exports = new MasterSlaveService();


