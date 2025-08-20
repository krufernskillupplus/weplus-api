// server.js - WEPLUS Commission API Server
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Supabase setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Multer for file uploads
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Partner credentials
const PARTNER_CREDENTIALS = {
    'johnweplus': { password: 'JohnWP2025ABCDEF', displayName: 'John WeePlus' },
    'krufernweplus': { password: 'KrufernWP2025123', displayName: 'Krufern WeePlus' },
    'aeirweplus': { password: 'AeirWP2025456789', displayName: 'Aeir WeePlus' },
    'neenyweplus': { password: 'NeenyWP2025XYZ12', displayName: 'Neeny WeePlus' }
};

// Helper functions
function convertExcelDate(dateInput) {
    if (!dateInput) return '';
    
    // Handle Excel serial number
    if (typeof dateInput === 'number' && dateInput > 40000) {
        const jsDate = new Date((dateInput - 25569) * 86400 * 1000);
        return jsDate.toISOString().split('T')[0];
    }
    
    // Handle string dates
    const dateStr = String(dateInput).trim();
    if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            let [month, day, year] = parts;
            if (Number(month) > 12) {
                [day, month, year] = parts;
            }
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
    }
    
    return dateStr;
}

function processExcelData(rawData) {
    if (!rawData || rawData.length < 2) {
        throw new Error('Invalid Excel data');
    }
    
    const processedData = [];
    
    rawData.slice(1).forEach((row, index) => {
        if (!row || row.length === 0) return;
        
        try {
            const record = {
                id: `record_${Date.now()}_${index}`,
                orderDate: convertExcelDate(row[0]) || '',
                courseName: row[1] || '',
                customerPayment: parseFloat(row[6]) || 0,
                affiliateCode: row[8] || '',
                affiliate10Recipient: row[9] || '',
                affiliate10Amount: parseFloat(row[12]) || 0,
                invitorCode: row[10] || '',
                invitor15Recipient: row[11] || '',
                invitor15Amount: parseFloat(row[13]) || 0,
                orderNo: row[16] || `ORDER-${index + 1}`,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            if (record.affiliate10Amount > 0 || record.invitor15Amount > 0) {
                processedData.push(record);
            }
        } catch (error) {
            console.warn(`Row ${index + 1} processing error:`, error);
        }
    });
    
    return processedData;
}

// Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Upload Excel file (for admin)
app.post('/api/upload-excel', upload.single('excelFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        // Process Excel file
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawData = xlsx.utils.sheet_to_json(firstSheet, { header: 1 });
        
        const processedData = processExcelData(rawData);
        
        // Clear existing data
        await supabase.from('commission_records').delete().neq('id', '');
        
        // Insert new data in batches
        const batchSize = 100;
        for (let i = 0; i < processedData.length; i += batchSize) {
            const batch = processedData.slice(i, i + batchSize);
            const { error } = await supabase.from('commission_records').insert(batch);
            if (error) throw error;
        }
        
        // Update last upload timestamp
        await supabase.from('system_info').upsert({
            key: 'last_upload',
            value: new Date().toISOString(),
            metadata: { recordCount: processedData.length }
        });
        
        res.json({
            success: true,
            message: `Successfully uploaded ${processedData.length} records`,
            recordCount: processedData.length,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ 
            error: 'Upload failed', 
            details: error.message 
        });
    }
});

// Partner login
app.post('/api/partner/login', (req, res) => {
    const { partnerCode, password } = req.body;
    
    if (!partnerCode || !password) {
        return res.status(400).json({ error: 'Partner code and password required' });
    }
    
    const partner = PARTNER_CREDENTIALS[partnerCode.toLowerCase()];
    if (!partner || partner.password !== password) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    res.json({
        success: true,
        partner: {
            code: partnerCode.toLowerCase(),
            displayName: partner.displayName
        }
    });
});

// Get partner data
app.get('/api/partner/:partnerCode/data', async (req, res) => {
    try {
        const { partnerCode } = req.params;
        const { fromDate, toDate } = req.query;
        
        // Verify partner exists
        if (!PARTNER_CREDENTIALS[partnerCode.toLowerCase()]) {
            return res.status(404).json({ error: 'Partner not found' });
        }
        
        // Get all commission records
        let query = supabase.from('commission_records').select('*');
        
        // Apply date filters if provided
        if (fromDate) {
            query = query.gte('orderDate', fromDate);
        }
        if (toDate) {
            query = query.lte('orderDate', toDate);
        }
        
        const { data: allRecords, error } = await query;
        if (error) throw error;
        
        // Filter records for this partner
        const partnerRecords = allRecords.filter(record => {
            const affiliate = record.affiliate10Recipient.toLowerCase();
            const invitor = record.invitor15Recipient.toLowerCase();
            const searchName = partnerCode.toLowerCase();
            
            return affiliate.includes(searchName) || invitor.includes(searchName) ||
                   searchName.includes(affiliate) || searchName.includes(invitor);
        });
        
        res.json({
            success: true,
            partner: partnerCode,
            recordCount: partnerRecords.length,
            data: partnerRecords,
            lastUpdated: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Get partner data error:', error);
        res.status(500).json({ 
            error: 'Failed to get partner data', 
            details: error.message 
        });
    }
});

// Get partner summary
app.get('/api/partner/:partnerCode/summary', async (req, res) => {
    try {
        const { partnerCode } = req.params;
        const { fromDate, toDate } = req.query;
        
        // Get partner data
        const response = await fetch(`${req.protocol}://${req.get('host')}/api/partner/${partnerCode}/data?fromDate=${fromDate || ''}&toDate=${toDate || ''}`);
        const partnerData = await response.json();
        
        if (!partnerData.success) {
            return res.status(500).json(partnerData);
        }
        
        // Calculate summary
        let totalOrders = 0;
        let total10 = 0;
        let total15 = 0;
        
        partnerData.data.forEach(record => {
            const affiliate = record.affiliate10Recipient.toLowerCase();
            const invitor = record.invitor15Recipient.toLowerCase();
            const searchName = partnerCode.toLowerCase();
            
            const isAffiliate = affiliate.includes(searchName) || searchName.includes(affiliate);
            const isInvitor = invitor.includes(searchName) || searchName.includes(invitor);
            
            if (isAffiliate && record.affiliate10Amount > 0) {
                total10 += record.affiliate10Amount;
                totalOrders++;
            }
            
            if (isInvitor && record.invitor15Amount > 0) {
                total15 += record.invitor15Amount;
                if (!isAffiliate) totalOrders++;
            }
        });
        
        res.json({
            success: true,
            partner: partnerCode,
            summary: {
                totalOrders,
                commission10: total10,
                commission15: total15,
                totalCommission: total10 + total15
            },
            dateRange: { fromDate, toDate },
            lastUpdated: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Get partner summary error:', error);
        res.status(500).json({ 
            error: 'Failed to get partner summary', 
            details: error.message 
        });
    }
});

// Get system info
app.get('/api/system/info', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('system_info')
            .select('*')
            .eq('key', 'last_upload')
            .single();
        
        if (error && error.code !== 'PGRST116') throw error;
        
        res.json({
            success: true,
            lastUpload: data?.value || null,
            metadata: data?.metadata || {}
        });
        
    } catch (error) {
        console.error('Get system info error:', error);
        res.status(500).json({ 
            error: 'Failed to get system info', 
            details: error.message 
        });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => {
    console.log(`🚀 WEPLUS Commission API Server running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
