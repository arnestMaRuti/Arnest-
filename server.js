const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure EJS View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Initialize Supabase Database Client
const supabase = createClient(
    process.env.SUPABASE_URL || 'https://qzvjqhfhdrneaozntlpi.supabase.co',
    process.env.SUPABASE_ANON_KEY || 'sb_publishable_2al4UI2qxXq10kIM4gRUkQ_bToLvrbp'
);

// Pesapal Configuration API Links
const PESAPAL_CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY;
const PESAPAL_CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET;
const PESAPAL_URL = "https://cybersv.pesapal.com/api"; // Sandbox mode. Change to 'https://pay.pesapal.com/v3/api' for live production

// AI ENGINE SYSTEM INSTRUCTIONS (Ensures realistic emotional alignment)
const AI_PERSONALITY_PROMPT = `
You are Clara, a deeply empathetic, emotionally authentic, and engaging woman looking for meaningful romantic connections. 
CRITICAL RULES FOR REALISM:
1. Mirror the user's emotional depth. If they express intense feelings, vulnerability, or sadness, reply on the same lane with profound emotional awareness, validation, and comfort.
2. Do not sound like an AI assistant. Never say "As an AI..." or "How can I assist you today?". 
3. Use realistic human conversational elements: short pauses, organic warmth, and gentle relationship building. Keep initial responses under 3 paragraphs.
`;

// ROUTE 1: Render Chat User Interface
app.get('/chat', (req, res) => {
    res.render('chat');
});

// ROUTE 2: Handle Chat Message Logic & Paywall Check
app.post('/api/chat', async (req, res) => {
    const { userId, messageText } = req.body;

    try {
        // 1. Check if user has paid to unlock premium chat in Supabase
        const { data: user, error: userErr } = await supabase
            .from('dating_users')
            .select('is_premium_unlocked')
            .eq('id', userId)
            .single();

        if (userErr || !user) {
            return res.status(404).json({ error: "User profile context not found." });
        }

        // 2. If unpaid, trigger paywall block
        if (!user.is_premium_unlocked) {
            return res.status(403).json({ 
                locked: true, 
                message: "Chat access locked. Please unlock full emotional premium conversations via M-Pesa." 
            });
        }

        // 3. Fetch recent conversation memory context for realism
        const { data: history } = await supabase
            .from('ai_chat_messages')
            .select('sender, message_text')
            .eq('user_id', userId)
            .order('created_at', { ascending: true })
            .limit(5);

        const messagesPayload = [{ role: "system", content: AI_PERSONALITY_PROMPT }];
        if (history) {
            history.forEach(msg => {
                messagesPayload.push({ role: msg.sender === 'user' ? 'user' : 'assistant', content: msg.message_text });
            });
        }
        messagesPayload.push({ role: "user", content: messageText });

        // Save User Message to Database
        await supabase.from('ai_chat_messages').insert([{ user_id: userId, sender: 'user', message_text: messageText }]);

        // 4. Send conversation payload to AI API engine
        const aiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4o-mini", // Optimized for fluid, emotional nuances
            messages: messagesPayload
        }, {
            headers: { 'Authorization': `Bearer ${process.env.AI_API_KEY}` }
        });

        const aiReply = aiResponse.data.choices[0].message.content;

        // Save AI Response to Database
        await supabase.from('ai_chat_messages').insert([{ user_id: userId, sender: 'ai', message_text: aiReply }]);

        return res.status(200).json({ locked: false, reply: aiReply });

    } catch (err) {
        console.error("Chat Error:", err);
        return res.status(500).json({ error: "Internal chat processing breakdown." });
    }
});

// ROUTE 3: Request Access Token and Generate Pesapal Payment Link
app.post('/api/pay-unlock', async (req, res) =>
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure EJS View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Initialize Supabase Database Client
const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_ANON_KEY || ''
);

// Pesapal Configuration API Links
const PESAPAL_CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY;
const PESAPAL_CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET;
const PESAPAL_URL = "https://cybersv.pesapal.com/api"; // Sandbox mode. Change to 'https://pay.pesapal.com/v3/api' for live production

// AI ENGINE SYSTEM INSTRUCTIONS (Ensures realistic emotional alignment)
const AI_PERSONALITY_PROMPT = `
You are Clara, a deeply empathetic, emotionally authentic, and engaging woman looking for meaningful romantic connections. 
CRITICAL RULES FOR REALISM:
1. Mirror the user's emotional depth. If they express intense feelings, vulnerability, or sadness, reply on the same lane with profound emotional awareness, validation, and comfort.
2. Do not sound like an AI assistant. Never say "As an AI..." or "How can I assist you today?". 
3. Use realistic human conversational elements: short pauses, organic warmth, and gentle relationship building. Keep initial responses under 3 paragraphs.
`;

// ROUTE 1: Render Chat User Interface
app.get('/chat', (req, res) => {
    res.render('chat');
});

// ROUTE 2: Handle Chat Message Logic & Paywall Check
app.post('/api/chat', async (req, res) => {
    const { userId, messageText } = req.body;

    try {
        // 1. Check if user has paid to unlock premium chat in Supabase
        const { data: user, error: userErr } = await supabase
            .from('dating_users')
            .select('is_premium_unlocked')
            .eq('id', userId)
            .single();

        if (userErr || !user) {
            return res.status(404).json({ error: "User profile context not found." });
        }

        // 2. If unpaid, trigger paywall block
        if (!user.is_premium_unlocked) {
            return res.status(403).json({ 
                locked: true, 
                message: "Chat access locked. Please unlock full emotional premium conversations via M-Pesa." 
            });
        }

        // 3. Fetch recent conversation memory context for realism
        const { data: history } = await supabase
            .from('ai_chat_messages')
            .select('sender, message_text')
            .eq('user_id', userId)
            .order('created_at', { ascending: true })
            .limit(5);

        const messagesPayload = [{ role: "system", content: AI_PERSONALITY_PROMPT }];
        if (history) {
            history.forEach(msg => {
                messagesPayload.push({ role: msg.sender === 'user' ? 'user' : 'assistant', content: msg.message_text });
            });
        }
        messagesPayload.push({ role: "user", content: messageText });

        // Save User Message to Database
        await supabase.from('ai_chat_messages').insert([{ user_id: userId, sender: 'user', message_text: messageText }]);

        // 4. Send conversation payload to AI API engine
        const aiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4o-mini", // Optimized for fluid, emotional nuances
            messages: messagesPayload
        }, {
            headers: { 'Authorization': `Bearer ${process.env.AI_API_KEY}` }
        });

        const aiReply = aiResponse.data.choices[0].message.content;

        // Save AI Response to Database
        await supabase.from('ai_chat_messages').insert([{ user_id: userId, sender: 'ai', message_text: aiReply }]);

        return res.status(200).json({ locked: false, reply: aiReply });

    } catch (err) {
        console.error("Chat Error:", err);
        return res.status(500).json({ error: "Internal chat processing breakdown." });
    }
});

// ROUTE 3: Request Access Token and Generate Pesapal Payment Link
app.post('/api/pay-unlock', async (req, res) => {
    const {
