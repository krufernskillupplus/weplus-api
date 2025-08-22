const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// CORS Configuration with preflight handling
app.use(cors({
    origin: ['https://www.weplusacademy.com', 'https://weplusacademy.com', 'http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));

// Handle preflight requests explicitly
app.options('*', cors());

// Additional CORS headers for problematic browsers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With, Accept, Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Supabase client initialization
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Partner credentials for authentication
const PARTNER_CREDENTIALS = {
    'krufernweplus': 'KrufernWP2025123',
    'johnweplus': 'JohnWP2025ABCDEF',
    'aeirweplus': 'AeirWP2025456789',
    'neenyweplus': 'NeenyWP2025XYZ12'
};

// Utility: Normalize Excel dates to YYYY-MM-DD format
function normalizeDate(dateString) {
    if (!dateString) return new Date().toISOString().split('T')[0];
    
    try {
        if (typeof dateString === 'number' && dateString > 1000) {
            // Excel serial date conversion
            const msPerDay = 24 * 60 * 60 * 1000;
            const excelEpoch = new Date(1899, 11, 30); // Excel epoch with leap year bug adjustment
            const utcDate = new Date(excelEpoch.getTime() + dateString * msPerDay);
            const thailandOffset = 7 * 60 * 60 * 1000; // UTC+7
            const thailandDate = new Date(utcDate.getTime() + thailandOffset);
            return thailandDate.toISOString().split('T')[0];
        } else if (typeof dateString === 'string') {
            const parsedDate = new Date(dateString);
            if (!isNaN(parsedDate.getTime())) {
                return parsedDate.toISOString().split('T')[0];
            }
        }
    } catch (e) {
        console.warn('Date parsing error:', e);
    }
    
    return new Date().toISOString().split('T')[0];
}

// API Routes

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'WEPLUS Commission API',
        version: '1.0.0',
        cors: 'enabled',
        preflight: 'handled',
        allowed_domains: ['www.weplusacademy.com', 'weplusacademy.com'],
        endpoints: [
            'GET /api/health',
            'POST /api/upload-excel',
            'POST /api/partner/login', 
            'GET /api/partner-data/:username',
            'GET /api/partner-summary/:username',
            'GET /api/system-status'
        ]
    });
});

// Upload Excel data from admin
app.post('/api/upload-excel', async (req, res) => {
    try {
        console.log('Upload request received from:', req.get('origin'));
        
        const { data, timestamp, source } = req.body;
        
        if (!data || !Array.isArray(data)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid data format. Expected array of records.'
            });
        }

        console.log(`Processing ${data.length} records from ${source || 'admin'}`);

        // Clear existing data before inserting new data
        const { error: deleteError } = await supabase
            .from('commission_records')
            .delete()
            .neq('id', '');
        
        if (deleteError) {
            console.error('Error clearing old data:', deleteError);
        } else {
            console.log('Cleared existing records');
        }

        // Process and format data for database
        const processedRecords = data.map((record, index) => ({
            id: `${Date.now()}-${index}`,
            order_date: normalizeDate(record.orderDate),
            course_name: record.courseName || '',
            customer_payment: parseFloat(record.customerPayment) || 0,
            affiliate_code: record.affiliateCode || '',
            affiliate10_recipient: record.affiliate10Recipient || '',
            affiliate10_amount: parseFloat(record.affiliate10Amount) || 0,
            invitor_code: record.invitorCode || '',
            invitor15_recipient: record.invitor15Recipient || '',
            invitor15_amount: parseFloat(record.invitor15Amount) || 0,
            order_no: record.orderNo || `ORDER-${index + 1}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }));

        console.log('Sample processed record:', processedRecords[0]);

        // Insert data in batches to handle large datasets
        const batchSize = 100;
        let insertedCount = 0;

        for (let i = 0; i < processedRecords.length; i += batchSize) {
            const batch = processedRecords.slice(i, i + batchSize);
            
            const { error: insertError } = await supabase
                .from('commission_records')
                .insert(batch);

            if (insertError) {
                console.error(`Error inserting batch ${i / batchSize + 1}:`, insertError);
                return res.status(500).json({
                    success: false,
                    error: `Database insert error: ${insertError.message}`
                });
            }

            insertedCount += batch.length;
            console.log(`Inserted batch ${i / batchSize + 1}: ${batch.length} records`);
        }

        // Update system metadata
        await supabase
            .from('system_info')
            .upsert({
                key: 'last_upload',
                value: new Date().toISOString(),
                metadata: {
                    record_count: insertedCount,
                    source: source || 'admin',
                    timestamp: timestamp
                }
            });

        console.log(`Upload completed: ${insertedCount} records inserted`);

        res.json({
            success: true,
            message: 'Data uploaded successfully',
            recordCount: insertedCount,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

// Partner login authentication
app.post('/api/partner/login', (req, res) => {
    try {
        const { username, password } = req.body;

        console.log(`Login attempt for: ${username}`);

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Username and password required'
            });
        }

        if (PARTNER_CREDENTIALS[username] === password) {
            console.log(`Login successful for: ${username}`);
            res.json({
                success: true,
                message: 'Login successful',
                username: username,
                timestamp: new Date().toISOString()
            });
        } else {
            console.log(`Login failed for: ${username}`);
            res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Get partner commission data with filtering
app.get('/api/partner-data/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const { from_date, to_date } = req.query;

        console.log(`Data request for partner: ${username}`);

        if (!PARTNER_CREDENTIALS[username]) {
            return res.status(404).json({
                success: false,
                error: 'Partner not found'
            });
        }

        // Build database query with partner filter
        let query = supabase
            .from('commission_records')
            .select('*')
            .or(`affiliate10_recipient.eq.${username},invitor15_recipient.eq.${username}`)
            .order('order_date', { ascending: false });

        // Apply date filters if provided
        if (from_date) {
            query = query.gte('order_date', from_date);
        }
        if (to_date) {
            query = query.lte('order_date', to_date);
        }

        const { data: records, error } = await query;

        if (error) {
            console.error('Database query error:', error);
            return res.status(500).json({
                success: false,
                error: 'Database query failed'
            });
        }

        // Calculate commission totals
        let totalCommission10 = 0;
        let totalCommission15 = 0;
        let recordCount = 0;

        const filteredRecords = records.filter(record => {
            const hasCommission = 
                (record.affiliate10_recipient === username && record.affiliate10_amount > 0) ||
                (record.invitor15_recipient === username && record.invitor15_amount > 0);
            
            if (hasCommission) {
                recordCount++;
                if (record.affiliate10_recipient === username) {
                    totalCommission10 += record.affiliate10_amount;
                }
                if (record.invitor15_recipient === username) {
                    totalCommission15 += record.invitor15_amount;
                }
            }
            
            return hasCommission;
        });

        console.log(`Found ${filteredRecords.length} records for ${username}`);

        res.json({
            success: true,
            username: username,
            records: filteredRecords,
            summary: {
                totalRecords: recordCount,
                totalCommission10: totalCommission10,
                totalCommission15: totalCommission15,
                grandTotal: totalCommission10 + totalCommission15
            },
            filters: {
                from_date: from_date || null,
                to_date: to_date || null
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Partner data error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

// Get partner summary statistics
app.get('/api/partner-summary/:username', async (req, res) => {
    try {
        const { username } = req.params;

        console.log(`Summary request for partner: ${username}`);

        if (!PARTNER_CREDENTIALS[username]) {
            return res.status(404).json({
                success: false,
                error: 'Partner not found'
            });
        }

        const { data: records, error } = await supabase
            .from('commission_records')
            .select('affiliate10_amount, invitor15_amount, order_date')
            .or(`affiliate10_recipient.eq.${username},invitor15_recipient.eq.${username}`);

        if (error) {
            console.error('Summary query error:', error);
            return res.status(500).json({
                success: false,
                error: 'Database query failed'
            });
        }

        // Calculate monthly breakdown
        let totalCommission10 = 0;
        let totalCommission15 = 0;
        let recordCount = 0;
        const monthlyTotals = {};

        records.forEach(record => {
            const month = record.order_date ? record.order_date.substring(0, 7) : 'unknown';
            
            if (!monthlyTotals[month]) {
                monthlyTotals[month] = { commission10: 0, commission15: 0, total: 0 };
            }

            if (record.affiliate10_amount > 0) {
                totalCommission10 += record.affiliate10_amount;
                monthlyTotals[month].commission10 += record.affiliate10_amount;
                recordCount++;
            }
            
            if (record.invitor15_amount > 0) {
                totalCommission15 += record.invitor15_amount;
                monthlyTotals[month].commission15 += record.invitor15_amount;
                recordCount++;
            }

            monthlyTotals[month].total = monthlyTotals[month].commission10 + monthlyTotals[month].commission15;
        });

        console.log(`Summary calculated for ${username}: ${recordCount} records`);

        res.json({
            success: true,
            username: username,
            summary: {
                totalRecords: recordCount,
                totalCommission10: totalCommission10,
                totalCommission15: totalCommission15,
                grandTotal: totalCommission10 + totalCommission15,
                monthlyBreakdown: monthlyTotals
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Summary error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

// System status endpoint
app.get('/api/system-status', async (req, res) => {
    try {
        const { data: systemInfo } = await supabase
            .from('system_info')
            .select('*');

        const { count } = await supabase
            .from('commission_records')
            .select('*', { count: 'exact', head: true });

        res.json({
            success: true,
            status: {
                database_connected: true,
                total_records: count || 0,
                system_info: systemInfo || [],
                server_time: new Date().toISOString(),
                cors_enabled: true,
                preflight_handled: true,
                allowed_origins: ['www.weplusacademy.com', 'weplusacademy.com']
            }
        });

    } catch (error) {
        console.error('System status error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'System status unavailable'
        });
    }
});

// Catch-all for undefined routes
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        available_endpoints: [
            'GET /api/health',
            'POST /api/upload-excel',
            'POST /api/partner/login',
            'GET /api/partner-data/:username',
            'GET /api/partner-summary/:username',
            'GET /api/system-status'
        ],
        cors_info: {
            enabled: true,
            preflight_handled: true,
            allowed_origins: ['www.weplusacademy.com', 'weplusacademy.com']
        }
    });
});

// Global error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`WEPLUS Commission API Server running on port ${PORT}`);
    console.log(`Started at: ${new Date().toISOString()}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
    console.log(`CORS enabled for: www.weplusacademy.com, weplusacademy.com`);
    console.log(`Preflight requests: HANDLED`);
    console.log('All endpoints ready for production use');
});

module.exports = app;