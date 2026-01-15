const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/database');
const { publishToQueue } = require('../config/messageQueue');
const { validateSOSRequest } = require('../middleware/validation');
const logger = require('../utils/logger');
const axios = require('axios');

// Create SOS request
router.post('/requests', validateSOSRequest, async (req, res, next) => {
  try {
    const {
      disasterId,
      requestedBy,
      requiredSkills,
      requiredResources,
      urgency,
      numberOfPeople,
      location,
      description,
      contactPhone,
    } = req.body;

    const requestId = `sos-${uuidv4()}`;

    // Verify disaster exists
    try {
      const disasterResponse = await axios.get(
        `${process.env.DISASTER_SERVICE_URL}/api/disasters/${disasterId}`,
        { timeout: 5000 }
      );
      if (disasterResponse.data.status !== 'active') {
        return res.status(400).json({
          error: { code: 'INVALID_DISASTER', message: 'Disaster is not active' },
        });
      }
    } catch (error) {
      logger.warn('Could not verify disaster', { disasterId, error: error.message });
    }

    // Insert into database
    const result = await pool.query(
      `INSERT INTO sos_requests (
        request_id, disaster_id, requested_by, required_skills, required_resources,
        urgency, number_of_people, location, description, contact_phone, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        requestId,
        disasterId,
        requestedBy,
        JSON.stringify(requiredSkills || []),
        JSON.stringify(requiredResources || []),
        urgency,
        numberOfPeople,
        JSON.stringify(location),
        description,
        contactPhone,
        'pending',
      ]
    );

    const sosRequest = {
      requestId: result.rows[0].request_id,
      disasterId: result.rows[0].disaster_id,
      requestedBy: result.rows[0].requested_by,
      status: result.rows[0].status,
      requiredSkills: result.rows[0].required_skills,
      requiredResources: result.rows[0].required_resources,
      urgency: result.rows[0].urgency,
      numberOfPeople: result.rows[0].number_of_people,
      location: result.rows[0].location,
      description: result.rows[0].description,
      contactPhone: result.rows[0].contact_phone,
      createdAt: result.rows[0].created_at,
      matchedAt: result.rows[0].matched_at,
      resolvedAt: result.rows[0].resolved_at,
    };

    // Trigger matching service
    try {
      publishToQueue(process.env.RABBITMQ_QUEUE_MATCHING || 'matching.trigger', {
        event: 'sos.request.created',
        data: {
          requestId,
          disasterId,
          urgency,
          requiredSkills,
          requiredResources,
          location,
        },
      });
    } catch (error) {
      logger.error('Failed to trigger matching', error);
    }

    res.status(201).json(sosRequest);
  } catch (error) {
    next(error);
  }
});

// Get all SOS requests
router.get('/requests', async (req, res, next) => {
  try {
    const { disasterId, status, urgency, location, radius = 10, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM sos_requests WHERE 1=1';
    const params = [];
    let paramCount = 0;

    if (disasterId) {
      paramCount++;
      query += ` AND disaster_id = $${paramCount}`;
      params.push(disasterId);
    }

    if (status) {
      paramCount++;
      query += ` AND status = $${paramCount}`;
      params.push(status);
    }

    if (urgency) {
      paramCount++;
      query += ` AND urgency = $${paramCount}`;
      params.push(urgency);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    const requests = result.rows.map((row) => ({
      requestId: row.request_id,
      disasterId: row.disaster_id,
      requestedBy: row.requested_by,
      status: row.status,
      urgency: row.urgency,
      location: row.location,
      createdAt: row.created_at,
    }));

    res.json({ requests, total: requests.length });
  } catch (error) {
    next(error);
  }
});

// Get specific SOS request
router.get('/requests/:requestId', async (req, res, next) => {
  try {
    const { requestId } = req.params;

    const result = await pool.query('SELECT * FROM sos_requests WHERE request_id = $1', [requestId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'SOS request not found' },
      });
    }

    const row = result.rows[0];

    // Get matches from matching service
    let matches = [];
    try {
      const matchResponse = await axios.get(
        `${process.env.MATCHING_SERVICE_URL}/api/matching/matches?requestId=${requestId}`,
        { timeout: 5000 }
      );
      matches = matchResponse.data.matches || [];
    } catch (error) {
      logger.warn('Could not fetch matches', { requestId, error: error.message });
    }

    const sosRequest = {
      requestId: row.request_id,
      disasterId: row.disaster_id,
      requestedBy: row.requested_by,
      status: row.status,
      requiredSkills: row.required_skills,
      requiredResources: row.required_resources,
      urgency: row.urgency,
      numberOfPeople: row.number_of_people,
      location: row.location,
      description: row.description,
      contactPhone: row.contact_phone,
      matches,
      createdAt: row.created_at,
      matchedAt: row.matched_at,
      resolvedAt: row.resolved_at,
    };

    res.json(sosRequest);
  } catch (error) {
    next(error);
  }
});

// Update SOS request status
router.put('/requests/:requestId/status', async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const { status } = req.body;

    const validStatuses = ['pending', 'matched', 'in_progress', 'resolved', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: { code: 'INVALID_STATUS', message: `Status must be one of: ${validStatuses.join(', ')}` },
      });
    }

    const updateFields = ['status = $1', 'updated_at = CURRENT_TIMESTAMP'];
    const params = [status];

    if (status === 'matched' && !req.body.matchedAt) {
      updateFields.push('matched_at = CURRENT_TIMESTAMP');
    }

    if (status === 'resolved') {
      updateFields.push('resolved_at = CURRENT_TIMESTAMP');
    }

    const result = await pool.query(
      `UPDATE sos_requests SET ${updateFields.join(', ')} WHERE request_id = $${params.length + 1} RETURNING *`,
      [...params, requestId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'SOS request not found' },
      });
    }

    const row = result.rows[0];
    res.json({
      requestId: row.request_id,
      status: row.status,
      matchedAt: row.matched_at,
      resolvedAt: row.resolved_at,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    next(error);
  }
});

// Trigger matching for a request
router.post('/requests/:requestId/trigger-matching', async (req, res, next) => {
  try {
    const { requestId } = req.params;

    const result = await pool.query('SELECT * FROM sos_requests WHERE request_id = $1', [requestId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'SOS request not found' },
      });
    }

    const row = result.rows[0];

    publishToQueue(process.env.RABBITMQ_QUEUE_MATCHING || 'matching.trigger', {
      event: 'sos.request.created',
      data: {
        requestId,
        disasterId: row.disaster_id,
        urgency: row.urgency,
        requiredSkills: row.required_skills,
        requiredResources: row.required_resources,
        location: row.location,
      },
    });

    res.json({
      requestId,
      matchingTriggered: true,
      message: 'Matching service notified',
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
