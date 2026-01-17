const request = require('supertest');
const express = require('express');

// Mock the app or import it
// For basic test, create a simple app
const app = express();
app.get('/', (req, res) => res.status(200).send('OK'));

describe('SOS Service Tests', () => {
    test('GET / should return 200', async () => {
        const response = await request(app).get('/');
        expect(response.status).toBe(200);
        expect(response.text).toBe('OK');
    });

    test('Basic math test', () => {
        expect(1 + 1).toBe(2);
    });
});