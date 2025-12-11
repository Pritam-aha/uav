/**
 * Master-Slave Routes
 * Handles master-slave drone communication and data aggregation
 */

const express = require('express');
const router = express.Router();
const masterSlaveService = require('../services/masterSlaveService');
const survivorService = require('../services/survivorService');
const { v4: uuidv4 } = require('uuid');

/**
 * POST /api/master-slave/set-master
 * Set the master drone
 */
router.post('/set-master', async (req, res) => {
    try {
        const { masterUAVId } = req.body;
        
        if (!masterUAVId) {
            return res.status(400).json({
                error: 'masterUAVId is required'
            });
        }

        const masterInfo = await masterSlaveService.setMasterDrone(masterUAVId);
        
        // Emit WebSocket event
        req.io.emit('master_drone_changed', {
            masterUAVId,
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            message: `Master drone set to ${masterUAVId}`,
            master: masterInfo
        });
    } catch (error) {
        console.error('Error setting master drone:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

/**
 * GET /api/master-slave/master
 * Get current master drone
 */
router.get('/master', async (req, res) => {
    try {
        const master = await masterSlaveService.getMasterDrone();
        
        if (!master) {
            return res.status(404).json({
                error: 'No master drone assigned'
            });
        }

        res.json({
            success: true,
            master
        });
    } catch (error) {
        console.error('Error getting master drone:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

/**
 * POST /api/master-slave/slave-data
 * Slave drone sends data to master
 */
router.post('/slave-data', async (req, res) => {
    try {
        const slaveData = req.body;
        
        // Validate required fields
        if (!slaveData.slaveUAVId || !slaveData.masterUAVId) {
            return res.status(400).json({
                error: 'slaveUAVId and masterUAVId are required'
            });
        }

        console.log(`📤 Slave ${slaveData.slaveUAVId} sending data to master ${slaveData.masterUAVId}`);

        // Store slave data transmission
        const storedData = await masterSlaveService.storeSlaveData({
            slaveUAVId: slaveData.slaveUAVId,
            masterUAVId: slaveData.masterUAVId,
            location: slaveData.location,
            batteryLevel: slaveData.batteryLevel,
            isacMode: slaveData.isacMode,
            signalStrength: slaveData.signalStrength,
            dataRate: slaveData.dataRate,
            detections: slaveData.detections || [],
            timestamp: slaveData.timestamp || new Date().toISOString()
        });

        // Process detections from slave
        if (slaveData.detections && slaveData.detections.length > 0) {
            console.log(`🔍 Processing ${slaveData.detections.length} detection(s) from slave ${slaveData.slaveUAVId}`);
            
            for (const detection of slaveData.detections) {
                try {
                    const survivor = await survivorService.createSurvivor({
                        id: detection.id || uuidv4(),
                        coordinates: detection.coordinates,
                        confidence: detection.confidence,
                        detectionType: detection.type || 'human',
                        uavId: slaveData.slaveUAVId, // Keep original UAV ID
                        timestamp: detection.timestamp || slaveData.timestamp,
                        status: 'detected',
                        additionalInfo: detection.additionalInfo || null
                    });
                    
                    console.log(`✅ Survivor ${survivor.id} saved from slave ${slaveData.slaveUAVId}`);
                    
                    // Emit real-time update via WebSocket
                    req.io.emit('survivor_detected', {
                        survivor: survivor,
                        uavData: {
                            uavId: slaveData.slaveUAVId,
                            location: slaveData.location,
                            isacMode: slaveData.isacMode,
                            signalStrength: slaveData.signalStrength,
                            source: 'slave'
                        }
                    });
                } catch (error) {
                    console.error(`Error processing detection from slave:`, error.message);
                }
            }
        }

        // Emit slave data update
        req.io.emit('slave_data_received', {
            slaveUAVId: slaveData.slaveUAVId,
            masterUAVId: slaveData.masterUAVId,
            location: slaveData.location,
            batteryLevel: slaveData.batteryLevel,
            isacMode: slaveData.isacMode,
            signalStrength: slaveData.signalStrength,
            detectionsCount: slaveData.detections ? slaveData.detections.length : 0,
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            message: 'Slave data received and processed',
            data: storedData
        });
    } catch (error) {
        console.error('Error processing slave data:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

/**
 * GET /api/master-slave/aggregated-data
 * Get aggregated data from all slaves for master
 */
router.get('/aggregated-data', async (req, res) => {
    try {
        const masterUAVId = req.query.masterUAVId;
        const limit = parseInt(req.query.limit) || 100;

        if (!masterUAVId) {
            return res.status(400).json({
                error: 'masterUAVId query parameter is required'
            });
        }

        const aggregatedData = await masterSlaveService.getAggregatedData(masterUAVId, limit);

        res.json({
            success: true,
            data: aggregatedData
        });
    } catch (error) {
        console.error('Error getting aggregated data:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

/**
 * GET /api/master-slave/slaves
 * Get all slave drones for a master
 */
router.get('/slaves', async (req, res) => {
    try {
        const masterUAVId = req.query.masterUAVId;

        if (!masterUAVId) {
            return res.status(400).json({
                error: 'masterUAVId query parameter is required'
            });
        }

        const slaves = await masterSlaveService.getSlaveDrones(masterUAVId);

        res.json({
            success: true,
            masterUAVId,
            slaves,
            count: slaves.length
        });
    } catch (error) {
        console.error('Error getting slave drones:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

/**
 * POST /api/master-slave/master-data
 * Master drone sends aggregated data to base station
 */
router.post('/master-data', async (req, res) => {
    try {
        const masterData = req.body;
        
        if (!masterData.masterUAVId) {
            return res.status(400).json({
                error: 'masterUAVId is required'
            });
        }

        // Get aggregated data from all slaves
        const aggregatedData = await masterSlaveService.getAggregatedData(
            masterData.masterUAVId,
            100
        );

        // Include master's own data
        const completeData = {
            masterUAVId: masterData.masterUAVId,
            masterData: {
                location: masterData.location,
                batteryLevel: masterData.batteryLevel,
                isacMode: masterData.isacMode,
                signalStrength: masterData.signalStrength,
                dataRate: masterData.dataRate,
                detections: masterData.detections || []
            },
            aggregatedSlaveData: aggregatedData,
            timestamp: new Date().toISOString()
        };

        // Emit complete aggregated data to frontend
        req.io.emit('master_aggregated_data', completeData);

        console.log(`👑 Master ${masterData.masterUAVId} sent aggregated data: ${aggregatedData.totalSlaves} slaves, ${aggregatedData.totalDetections} detections`);

        res.json({
            success: true,
            message: 'Master aggregated data received',
            data: completeData
        });
    } catch (error) {
        console.error('Error processing master data:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

module.exports = router;


