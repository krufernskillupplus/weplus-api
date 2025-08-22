const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 8080;

// Enhanced CORS configuration
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:8080',
    'https://krufernSkillupplus.github.io',
    'https://weplusacademy.com',
    'https://www.weplusacademy.com',
    // Add any other domains that need access
    /\.railway\.app$/,  // Allow all Railway subdomains
    /\.github\.io$/,    // Allow GitHub Pages
    /localhost:\d+$/    // Allow any localhost port
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Handle preflight requests
app.options('*', cors());

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Add request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  console.log('Origin:', req.get('Origin'));
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'WEPLUS Commission API Server running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Commission data storage (in production, use a database)
let commissionData = [];

// Upload Excel data endpoint
app.post('/api/upload-excel', (req, res) => {
  try {
    const { data, timestamp, source } = req.body;
    
    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: 'Invalid data format' });
    }

    // Store the data (in production, save to database)
    commissionData = data;
    
    console.log(`Received ${data.length} commission records from ${source}`);
    
    res.json({ 
      success: true, 
      message: 'Data uploaded successfully',
      recordCount: data.length,
      timestamp: timestamp
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get commission data endpoint
app.get('/api/commission-data', (req, res) => {
  try {
    res.json({
      success: true,
      data: commissionData,
      count: commissionData.length
    });
  } catch (error) {
    console.error('Get data error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Catch-all route for debugging
app.use('*', (req, res) => {
  console.log(`404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    error: 'Route not found',
    method: req.method,
    url: req.originalUrl,
    availableRoutes: [
      'GET /api/health',
      'POST /api/upload-excel',
      'GET /api/commission-data'
    ]
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`WEPLUS Commission API Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;