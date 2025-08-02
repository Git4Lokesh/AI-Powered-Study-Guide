import axios from "axios";
import bodyParser from "body-parser";
import express from "express";
import { marked } from "marked";
import session from "express-session";
import dotenv from "dotenv";
import multer from 'multer';
import FormData from 'form-data';
import pg from 'pg';
import bcrypt from 'bcrypt';
import passport from 'passport';
import {Strategy} from 'passport-local';
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const saltRounds = 12;

// Database configuration - works for both local and production
const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { 
    rejectUnauthorized: false 
  } : false
});

marked.setOptions({
    breaks: true,
    gfm: true,
    sanitize: true
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));
app.set('view engine', 'ejs');
app.set('views', './views');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
        }
    }
});

app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-here',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 24
    }
}));

app.use(passport.initialize());
app.use(passport.session());

function processMathContent(content) {
    let processedContent = content;
    
    processedContent = processedContent.replace(/\$\$(.*?)\$\$/g, (match, equation) => {
        return `<span class="math-equation">${equation.trim()}</span>`;
    });
    
    processedContent = processedContent.replace(/\\\\(.*?)\\\\/g, (match, equation) => {
        return `<span class="math-equation">${equation.trim()}</span>`;
    });
    processedContent = processedContent.replace(/\/\/(.*?)\/\//g, (match, equation) => {
        return `<span class="math-equation">${equation.trim()}</span>`;
    });
    
    processedContent = processedContent.replace(/\\\((.*?)\\\)/g, (match, equation) => {
        return `<span class="math-equation">${equation.trim()}</span>`;
    });
    processedContent = processedContent.replace(/\\\[(.*?)\\\]/g, (match, equation) => {
        return `<span class="math-equation">${equation.trim()}</span>`;
    });
    
    return processedContent;
}

// Database initialization function
async function initializeDatabase() {
    try {
        // Users table
        await db.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Add user_id columns safely (won't crash if already exists)
        try {
            await db.query(`ALTER TABLE quicknotes ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;`);
        } catch (err) {
            if (!err.message.includes('already exists')) {
                console.error('Error adding user_id to quicknotes:', err.message);
            }
        }

        try {
            await db.query(`ALTER TABLE flashcards ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;`);
        } catch (err) {
            if (!err.message.includes('already exists')) {
                console.error('Error adding user_id to flashcards:', err.message);
            }
        }

        try {
            await db.query(`ALTER TABLE quiz ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;`);
        } catch (err) {
            if (!err.message.includes('already exists')) {
                console.error('Error adding user_id to quiz:', err.message);
            }
        }

        console.log("Database initialized successfully");
    } catch (error) {
        console.error("Database initialization failed:", error);
    }
}

// Initialize database on startup
initializeDatabase();

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

// Authentication middleware
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
}

// Routes
app.get("/", ensureAuthenticated, async (req, res) => {
    try {
        const response = await db.query(`
            SELECT SUM(row_count) AS total_rows FROM (
                SELECT COUNT(*) AS row_count FROM quiz WHERE user_id=$1
                UNION ALL
                SELECT COUNT(*) AS row_count FROM quicknotes where user_id=$1
                UNION ALL
                SELECT COUNT(*) AS row_count FROM flashcards where user_id=$1
            ) AS counts
        `, [req.user.id]);
        
        const savedContentCount = parseInt(response.rows[0].total_rows) || 0;
        
        res.render("dashboard.ejs", {
            savedContentCount: savedContentCount,
            user: req.user
        });
    } catch (error) {
        console.error('Error counting saved content:', error);
        res.render("dashboard.ejs", {
            savedContentCount: 0,
            user: req.user
        });
    }
});

app.get("/signup", (req, res) => {
    res.render("signup.ejs");
});

app.get("/login", (req, res) => {
    res.render("login.ejs");
});

app.post("/signup", async (req, res) => {
    try {
        const name = req.body.fullName;
        const email = req.body.email;
        const password = req.body.password;
        
        const result = await db.query("SELECT * FROM users WHERE email=$1", [email]);
        if (result.rowCount > 0) {
            return res.send("Email already exists, try logging in");
        }
        
        const hash = await bcrypt.hash(password, saltRounds);
        const userresult = await db.query("INSERT INTO users (email,password,name) VALUES ($1,$2,$3) RETURNING *", [email, hash, name]);
        const user = userresult.rows[0];
        
        req.login(user, (err) => {
            if (err) {
                console.log(err);
                return res.status(500).send("Login failed");
            }
            res.redirect("/");
        });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).send("Registration failed");
    }
});

app.post("/login", (req, res, next) => {
    console.log("=== LOGIN ATTEMPT ===");
    console.log("Email:", req.body.email);
    console.log("Password provided:", !!req.body.password);
    
    passport.authenticate("local", (err, user, info) => {
        console.log("Passport callback - Error:", err);
        console.log("Passport callback - User:", !!user);
        console.log("Passport callback - Info:", info);
        
        if (err) {
            console.error("Authentication error:", err);
            return next(err);
        }
        
        if (!user) {
            console.log("Authentication failed - no user returned");
            return res.redirect("/login?error=invalid");
        }
        
        req.logIn(user, (loginErr) => {
            if (loginErr) {
                console.error("Login error:", loginErr);
                return next(loginErr);
            }
            console.log("✅ Login successful - redirecting to dashboard");
            return res.redirect("/");
        });
    })(req, res, next);
});

app.post("/logout", (req, res) => {
    req.logout((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).send('Logout failed');
        }
        res.redirect("/login");
    });
});

// Passport configuration
passport.use(new Strategy({
    usernameField: 'email',
    passwordField: 'password'
}, async function(email, password, done) {
    try {
        console.log("=== PASSPORT STRATEGY ===");
        console.log("Attempting auth for:", email);
        
        if (!email || !password) {
            console.log("❌ Missing email or password");
            return done(null, false, { message: 'Email and password required' });
        }
        
        const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);
        console.log("Database query returned:", result.rowCount, "rows");
        
        if (result.rowCount === 0) {
            console.log("❌ No user found with email:", email);
            return done(null, false, { message: 'Invalid credentials' });
        }
        
        const user = result.rows[0];
        console.log("✅ User found - ID:", user.id);
        
        const isMatch = await bcrypt.compare(password, user.password);
        console.log("Password comparison result:", isMatch);
        
        if (isMatch) {
            console.log("✅ Password matches - authentication successful");
            return done(null, user);
        } else {
            console.log("❌ Password does not match");
            return done(null, false, { message: 'Invalid credentials' });
        }
        
    } catch (error) {
        console.error("❌ Strategy error:", error);
        return done(error);
    }
}));

passport.serializeUser((user, cb) => {
    const { password, ...userWithoutPassword } = user;
    cb(null, userWithoutPassword);
});

passport.deserializeUser((user, cb) => {
    cb(null, user);
});

// Main generation route
app.post("/generate", ensureAuthenticated, upload.single('document'), async (req, res) => {
    const topic = req.body.topic;
    const level = req.body.gradeLevel;
    const type = req.body.studyType;
    const method = req.body.inputMethod;
    req.session.topic = topic;
    req.session.level = level;
    
    if (!level || !type) {
        return res.status(400).send("Please fill in all required fields");
    }
    
    if (method === "topic") {
        if (!topic) {
            return res.status(400).send("Please enter a topic");
        }
        
        if (type === "quicknotes") {
            try {
                const response = await axios.post("https://api.perplexity.ai/chat/completions", {
                    model: "sonar-pro",
                    messages: [
                        {
                            "role": "system",
                            "content": "You are an expert educator. Create study materials in HTML format with proper tags. Never show your research process or mention search results. Start directly with the educational content. For ALL mathematical expressions, use proper notation enclosed in $$ (e.g., $$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$)"
                        },
                        {
                            "role": "user",
                            "content": `Write extremely thorough study notes on ${topic} for ${level} level students. The student should be able to revise this for exams.

Format Requirements:
- Start with a clear definition
- Use HTML tags: <h1>, <h2>, <h3> for headings
- Use <strong> for bold, <em> for italic
- Use <p> for paragraphs and <br> for line breaks
- Use <ul><li> for bullet points
- Add practical examples
- No meta-commentary about sources
- No phrases like "based on the search results"
- If mathematical in nature, include example problems with solutions formatted in $$...$$ notation
- ALL mathematical expressions MUST use proper notation enclosed in $$ (e.g., $$E = mc^2$$)

Topic: ${topic}
Level: ${level}`
                        }
                    ]
                }, {
                    headers: {
                        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`
                    }
                });
                
                req.session.content = response.data.choices[0].message.content
                res.render("quicknotes.ejs", {
                    topic: topic,
                    gradeLevel: level,
                    content: response.data.choices[0].message.content
                });
                
            } catch (error) {
                console.error("Quick notes error:", error.message);
                res.status(500).send("Failed to generate notes. Please try again.");
            }
        }
        else if (type === "flashcards") {
            try {
                const response = await axios.post("https://api.perplexity.ai/chat/completions", {
                    "model": "sonar-pro",
                    "messages": [
                        {
                            "role": "system",
                            "content": "Create flashcards in JSON format. Return only a JSON array of objects with 'question' and 'answer' properties. ALL mathematical expressions MUST use proper notation enclosed in $$ (e.g., $$\\frac{1}{2}$$)"
                        },
                        {
                            "role": "user",
                            "content": `Generate 10 flashcards for ${topic} at ${level} school level. Format as JSON array: [{"question": "...", "answer": "..."}].

Requirements:
- No meta-commentary about sources
- No phrases like "based on the search results"
- Include mathematical concepts in $$...$$ notation where needed
- ALL mathematical expressions MUST use proper notation enclosed in $$`
                        }
                    ]
                }, {
                    headers: {
                        "Authorization": `Bearer ${process.env.PERPLEXITY_API_KEY}`,
                        "Content-Type": "application/json"
                    }
                });
                
                const flashcards = JSON.parse(response.data.choices[0].message.content);
                
                req.session.flashcards = flashcards;
                req.session.topic = topic;
                req.session.gradeLevel = level;
                
                res.render("flashcards.ejs", {
                    topic: topic,
                    gradeLevel: level,
                    content: flashcards,
                    currentIndex: 0,
                    showAnswer: false
                });
                
            } catch (error) {
                console.error("Flashcards error:", error.message);
                res.status(500).send("Failed to generate flashcards. Please try again.");
            }
        } 
        else {
            try {
                const response = await axios.post("https://api.perplexity.ai/chat/completions", {
                    model: "sonar-pro",
                    messages: [
                        {
                            "role": "system",
                            "content": "You are an expert educational content creator. Generate quiz questions in strict JSON format. Return ONLY a valid JSON array with no additional text, explanations, or formatting. Each question must have exactly 4 distinct, plausible options with one clearly correct answer. ALL mathematical expressions MUST use proper notation enclosed in $$ (e.g., $$x^2 + 5x + 6$$)"
                        },
                        {
                            "role": "user", 
                            "content": `Create a 10-question multiple choice quiz about ${topic} for ${level} school students.

Requirements:
- Format: JSON array only, no other text
- Each question must have: question, option1, option2, option3, option4, answer
- Answer field must specify which option is correct (e.g., "option2")
- All options should be plausible but only one correct
- Questions should test understanding, not just memorization
- Use clear, grade-appropriate language
- ONLY IF the topic is mathematical in nature or could have calculation based questions, include 3-4 questions which involve calculations
- ALL mathematical expressions MUST use proper notation enclosed in $$ (e.g., $$\\sqrt{25} = 5$$)

Example format:
[
    {
        "question": "What is the discriminant of the quadratic equation $$ax^2 + bx + c = 0$$?",
        "option1": "$$b^2 - 4ac$$",
        "option2": "$$-b \\pm \\sqrt{b^2 - 4ac}$$", 
        "option3": "$$4ac - b^2$$",
        "option4": "$$a^2 + b^2 + c^2$$",
        "answer": "option1"
    }
]

Topic: ${topic}
Grade Level: ${level}`
                        }
                    ]
                }, {
                    headers: {
                        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`
                    }
                });
                
                const content = JSON.parse(response.data.choices[0].message.content);
                req.session.topic = topic;
                req.session.gradeLevel = level;
                req.session.content = content;
                
                res.render("quiz.ejs", {
                    topic: topic,
                    gradeLevel: level,
                    content: content,
                    showResults: false
                });
                
            } catch (error) {
                console.error("Quiz error:", error.message);
                res.status(500).send("Failed to generate quiz. Please try again.");
            }
        }
    }
    else {
        if (!req.file) {
            return res.status(400).send("Please upload a PDF file");
        }
        
        try {
            console.log("Processing PDF with LlamaParse API...");
            
            const formData = new FormData();
            formData.append('file', req.file.buffer, {
                filename: req.file.originalname,
                contentType: 'application/pdf'
            });
            
            const uploadResponse = await axios.post(
                'https://api.cloud.llamaindex.ai/api/v1/parsing/upload',
                formData,
                {
                    headers: {
                        'accept': 'application/json', 
                        'Authorization': `Bearer ${process.env.LLAMA_CLOUD_API_KEY}`,
                        ...formData.getHeaders()
                    }
                }
            );
            
            const jobId = uploadResponse.data.id;
            console.log("Upload successful, job ID:", jobId);
            
            let jobComplete = false;
            let attempts = 0;
            const maxAttempts = 30;
            
            while (!jobComplete && attempts < maxAttempts) {
                const statusResponse = await axios.get(
                    `https://api.cloud.llamaindex.ai/api/v1/parsing/job/${jobId}`,
                    {
                        headers: {
                            'accept': 'application/json', 
                            'Authorization': `Bearer ${process.env.LLAMA_CLOUD_API_KEY}` 
                        }
                    }
                );
                
                if (statusResponse.data.status === 'SUCCESS') {
                    jobComplete = true;
                } else if (statusResponse.data.status === 'ERROR') {
                    throw new Error('PDF parsing failed');
                } else {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    attempts++;
                }
            }
            
            if (!jobComplete) {
                throw new Error('PDF parsing timeout');
            }
            
            const resultResponse = await axios.get(
                `https://api.cloud.llamaindex.ai/api/v1/parsing/job/${jobId}/result/markdown`,
                {
                    headers: {
                        'accept': 'application/json',
                        'Authorization': `Bearer ${process.env.LLAMA_CLOUD_API_KEY}` 
                    }
                }
            );
            
            const extractedText = resultResponse.data.markdown;
            console.log("LlamaParse extraction successful, text length:", extractedText.length);
            
            if (!extractedText || extractedText.trim().length < 50) {
                return res.status(400).send("PDF content appears to be empty or too short. Please ensure the PDF contains readable text.");
            }
            
            if (type === "quicknotes") {
                const response = await axios.post("https://api.perplexity.ai/chat/completions", {
                    model: "sonar-pro",
                    messages: [
                        {
                            "role": "system",
                            "content": "You are an expert educator specializing in analyzing comprehensive academic course materials. Transform content into well-organized study notes with HTML formatting. ALL mathematical expressions MUST use proper notation enclosed in $$ (e.g., $$F = ma$$)"
                        },
                        {
                            "role": "user",
                            "content": `Transform the following comprehensive course material into detailed study notes for ${level} level students:

COMPREHENSIVE COURSE MATERIAL:
${extractedText}

Create study notes with these requirements:
- Use HTML formatting: <h2>, <h3>, <p>, <ul>, <li>, <strong>
- Preserve mathematical formulas in $$...$$ notation
- Structure content logically for exam preparation
- ALL mathematical expressions MUST use proper notation enclosed in $$

Format: Use HTML formatting with proper tags.`
                        }
                    ]
                }, {
                    headers: {
                        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`
                    }
                });
                
                res.render("quicknotes.ejs", {
                    topic: "Course Material Analysis",
                    gradeLevel: level,
                    content: response.data.choices[0].message.content 
                });
            }
            else if (type === "flashcards") {
                const response = await axios.post("https://api.perplexity.ai/chat/completions", {
                    "model": "sonar-pro",
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are an expert educator creating flashcards from comprehensive course material that includes properly extracted text, mathematical notation, table data, and visual element descriptions. Return only a JSON array of objects with 'question' and 'answer' properties. ALL mathematical expressions MUST use proper notation enclosed in $$ (e.g., $$\\int x dx = \\frac{x^2}{2} + C$$)"
                        },
                        {
                            "role": "user",
                            "content": `Analyze the following comprehensive course material and create 10 high-quality flashcards for ${level} level students. This content includes properly extracted mathematical formulas, table data, and visual element descriptions.

COMPREHENSIVE COURSE MATERIAL:
${extractedText}

Requirements:
- Format as JSON array: [{"question": "...", "answer": "..."}]
- Include questions about key concepts, definitions, and important principles
- Include questions about mathematical formulas, equations, and calculations
- Create questions about data from tables and charts mentioned
- Include questions about visual elements and their significance
- Test both factual knowledge and conceptual understanding
- Use clear, ${level}-appropriate language
- Make answers comprehensive but concise
- Cover the full breadth of content including visual and mathematical elements
- Return only a valid JSON array.
- Do not include any Markdown code fences, explanations, or extra text.
- Output must start directly with '[' and end with ']'.
- Generate exactly 10 flashcards covering the most essential content from this material.
- ALL mathematical expressions MUST use proper notation enclosed in $$`
                        }
                    ]
                }, {
                    headers: {
                        "Authorization": `Bearer ${process.env.PERPLEXITY_API_KEY}`,
                        "Content-Type": "application/json"
                    }
                });
                
                const flashcards = JSON.parse(response.data.choices[0].message.content);
                
                req.session.flashcards = flashcards;
                req.session.topic = "Course Material";
                req.session.gradeLevel = level;
                
                res.render("flashcards.ejs", {
                    topic: "Course Material",
                    gradeLevel: level,
                    content: flashcards,
                    currentIndex: 0,
                    showAnswer: false
                });
            }
            else {
                const response = await axios.post("https://api.perplexity.ai/chat/completions", {
                    model: "sonar-pro",
                    messages: [
                        {
                            "role": "system",
                            "content": "You are an expert educational assessment creator analyzing comprehensive course material with properly extracted mathematical notation, table data, and visual element descriptions. Generate quiz questions in strict JSON format. Return ONLY a valid JSON array with no additional text, explanations, or formatting. ALL mathematical expressions MUST use proper notation enclosed in $$ (e.g., $$y = mx + b$$)"
                        },
                        {
                            "role": "user", 
                            "content": `Create a comprehensive 10-question multiple choice quiz based on the following extracted course material for ${level} students. This content includes mathematical formulas, table data, and visual element descriptions.

COMPREHENSIVE COURSE MATERIAL:
${extractedText}

Requirements:
- Format: JSON array only, no other text
- Each question must have: question, option1, option2, option3, option4, answer
- Answer field must specify which option is correct (e.g., "option2")
- All options should be plausible but only one correct
- Include questions about key definitions, principles, and applications
- Include questions about mathematical formulas and calculations when present
- Include questions about data from tables and charts
- Include questions about visual elements and their significance
- Test both factual recall and conceptual understanding
- Use clear, ${level}-appropriate language
- Cover different aspects of the comprehensive material provided
- ALL mathematical expressions MUST use proper notation enclosed in $$
- Generate exactly 10 questions covering the essential content from this course material.`
                        }
                    ]
                }, {
                    headers: {
                        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`
                    }
                });
                
                const content = JSON.parse(response.data.choices[0].message.content);
                req.session.topic = "Course Material";
                req.session.gradeLevel = level;
                req.session.content = content;
                
                res.render("quiz.ejs", {
                    topic: "Course Material",
                    gradeLevel: level,
                    content: content,
                    showResults: false
                });
            }
            
        } catch (error) {
            console.error("LlamaParse API error:", error.message);
            
            if (error.response?.status === 429) {
                return res.status(429).send("API rate limit reached. Please try again later.");
            }
            
            if (error.response?.status === 401) {
                return res.status(500).send("Authentication failed. Check your LLAMA_CLOUD_API_KEY.");
            }
            
            return res.status(500).send("Failed to process PDF. Please try again.");
        }
    }
});

// Flashcard navigation
app.post("/flashcard", ensureAuthenticated, (req, res) => {
    if (!req.session.flashcards) {
        return res.redirect('/');
    }
    
    const currentIndex = parseInt(req.body.currentIndex);
    const showAnswer = req.body.showAnswer === "true";
    
    res.render("flashcards.ejs", {
        topic: req.session.topic,
        gradeLevel: req.session.gradeLevel,
        content: req.session.flashcards,
        currentIndex: currentIndex,
        showAnswer: showAnswer
    });
});

// Quiz submission and analysis
app.post("/quiz", ensureAuthenticated, async (req, res) => {
    var showResults = true;
    var userAnswers = [];
    var score = 0;
    
    for(let i = 0; i < 10; i++) {
        userAnswers.push(req.body[`answer_${i}`]);
        if(req.body[`answer_${i}`] === req.session.content[i].answer) {
            score++;
        }
    }

    const prompt = `Analyze this quiz performance:
        
Topic: ${req.session.topic}
Grade Level: ${req.session.gradeLevel}
Score: ${score}/${req.session.content.length}

Questions and Answers:
${JSON.stringify({
    questions: req.session.content,
    userAnswers: userAnswers,
    score: score,
    total: req.session.content.length
}, null, 2)}

Provide a comprehensive analysis with:
1. Overall Performance Summary
2. Key Strengths
3. Areas for Improvement
4. Study Recommendations
5. Recommended youtube videos or websites

IMPORTANT: Format your response in proper HTML with:
- Use <h2> for main headings (e.g., <h2>Overall Performance Summary</h2>)
- Use <h3> for subheadings if needed
- Use <ul><li> for bullet points in lists
- Use <strong>text</strong> for bold emphasis
- Use <br> tags for line breaks where needed
- Make it clean and well-structured for web display
- Refer to the person as if you're talking to them, not as "the student".
- Do NOT use Markdown syntax (##, -, **) - use actual HTML tags only
- If referencing mathematical concepts, use $$...$$ proper latex notation`;

    const analysis = await axios.post("https://api.perplexity.ai/chat/completions",{
        model:"sonar-pro",
        messages:[
            {
                role:"system",
                content:"You are an expert educator in "+req.session.topic+". Analyze quiz data and provide actionable insights. For mathematical expressions, use $$...$$ notation."
            },
            {
                role:"user",
                content:prompt
            }
        ]
    },{
        headers:{
            Authorization:`Bearer ${process.env.PERPLEXITY_API_KEY}`
        }
    })
    
    const processedAnalysis = processMathContent(analysis.data.choices[0].message.content);
    
    res.render("quiz.ejs",{
        topic:req.session.topic,
        gradeLevel:req.session.gradeLevel,
        content:req.session.content,
        showResults:showResults,
        userAnswers:userAnswers,
        score:score,
        performanceAnalysis: processedAnalysis
    })
});

// Text expansion API
app.post('/api/expand-text', ensureAuthenticated, async (req, res) => {
    try {
        const { text, type, prompt, topic, gradeLevel, customQuestion } = req.body;
        
        const isCustomQuestion = type === 'custom' && customQuestion;
        
        let finalPrompt;
        
        if (isCustomQuestion) {
            finalPrompt = `Context: "${text}" from ${topic} study notes for ${gradeLevel} students.

Student Question: "${customQuestion}"

FORMATTING REQUIREMENTS: 
-RETURN HTML FORMATTED CONTENT (use <p>, <strong>, <ul> tags and etcetera)
- Use LaTeX notation for math : \\( \\) for inline, \\[ \\] for display
-Keep responses concise
-Use HTML formatting for emphasis and structure
-No markdown formatting,only HTML tags

Please provide a brief, HTML-formatted answer that:
- Directly addresses the student's specific question
- Uses the highlighted text as context
- Is under 150 words
- Uses LaTeX notation for math expressions
- Provides clear, educational explanations relevant to ${gradeLevel} level`;
        } else {
            // Original pre-defined context prompt
            finalPrompt = `${prompt}

Context: This is from study notes about "${topic}" for ${gradeLevel} level students from a previous prompt, you have to provide additional explanation.

FORMATTING REQUIREMENTS: 
-RETURN HTML FORMATTED CONTENT (use <p>, <strong>, <ul> tags and etcetera)
- Use LaTeX notation for math : \\( \\) for inline, \\[ \\] for display
-Keep responses concise
-Use HTML formatting for emphasis and structure
-No markdown formatting,only HTML tags

Please provide a comprehensive response that:
- Is appropriate for ${gradeLevel} level understanding
- Uses proper formatting including LaTeX for mathematical expressions
- Provides clear, educational explanations
- Includes relevant examples where helpful
- As this is further context, be extremely concise and quick to the point. Should not exceed 100 words.
- Do not delve into irrelevant topics, do exactly what is needed.

Text to expand: "${text}"`;
        }
        
        const response = await axios.post("https://api.perplexity.ai/chat/completions", {
            model: "sonar",
            messages: [
                {
                    role: "system",
                    content: "You are an expert educator providing detailed explanations for study materials. Use proper LaTeX formatting for mathematical expressions."
                },
                {
                    role: "user",
                    content: finalPrompt
                }
            ]
        }, {
            headers: {
                Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`
            }
        });

        const expansion = response.data.choices[0].message.content;
        console.log(expansion);
        res.json({ expansion });
    } catch (error) {
        console.error('Text expansion error:', error);
        res.status(500).json({ error: 'Failed to generate expansion' });
    }
});

// Save content routes
app.post("/save-quicknotes", ensureAuthenticated, async (req, res) => {
    try {
        const topic = req.body.topic;
        const level = req.body.gradeLevel;
        const content = req.body.content;
        
        await db.query(
            "INSERT INTO quicknotes(topic, gradeLevel, note_content, user_id) VALUES ($1,$2,$3,$4)",
            [topic, level, content, req.user.id]
        );
        
        res.render('quicknotes.ejs', {
            topic: topic,
            gradeLevel: level,
            content: content,
            saved: true
        });
    } catch (error) {
        console.error('Error saving notes:', error);
        res.status(500).send("Error saving notes");
    }
});

app.post("/save-flashcards", ensureAuthenticated, async (req, res) => {
    try {
        const topic = req.body.topic;
        const gradeLevel = req.body.gradeLevel;
        
        await db.query(`
            INSERT INTO flashcards(topic, grade_level, card_content, user_id) 
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (topic, grade_level, user_id) 
            DO UPDATE SET card_content = $3
        `, [topic, gradeLevel, req.body.content, req.user.id]);
        
        res.render("flashcards.ejs", {
            topic: topic,
            gradeLevel: gradeLevel,
            content: JSON.parse(req.body.content),
            showAnswer: req.body.showAnswer === 'true',
            currentIndex: parseInt(req.body.index) || 0, 
            savedMessage: "Flashcards saved successfully!"
        });
        
    } catch (error) {
        console.error('Error saving flashcards:', error);
        res.render("flashcards.ejs", {
            topic: req.body.topic || '',
            gradeLevel: req.body.gradeLevel || '',
            content: req.body.content ? JSON.parse(req.body.content) : [],
            showAnswer: req.body.showAnswer === 'true',
            currentIndex: parseInt(req.body.index) || 0,
            savedMessage: null,
            errorMessage: "Failed to save flashcards"
        });
    }
});

app.post("/save-quiz", ensureAuthenticated, async (req, res) => {
    try {
        const topic = req.body.topic;
        const gradeLevel = req.body.gradeLevel;
        const content = req.body.content;
        
        await db.query("INSERT INTO quiz(topic,gradeLevel,content,user_id) VALUES ($1,$2,$3,$4)", [topic, gradeLevel, content, req.user.id]);
        
        res.render("quiz.ejs", {
            topic: topic,
            gradeLevel: gradeLevel,
            content: JSON.parse(content),
            score: parseInt(req.body.score),
            userAnswers: JSON.parse(req.body.userAnswers),
            performanceAnalysis: req.body.performanceAnalysis,
            showResults: true,
            saved: true
        });
    } catch (error) {
        console.error('Error saving quiz:', error);
        res.status(500).send("Error saving quiz");
    }
});

// Saved content routes
app.get("/saved-content", ensureAuthenticated, (req, res) => {
    res.render("saved-content.ejs");
});

// API routes for saved content
app.get("/api/quicknotes", ensureAuthenticated, async (req, res) => {
    try {
        const response = await db.query("SELECT id,topic,gradelevel,created_at FROM quicknotes WHERE user_id=$1 ORDER BY created_at DESC", [req.user.id]);
        res.json(response.rows);
    } catch (error) {
        console.error('Error fetching quicknotes:', error);
        res.status(500).json({ error: 'Failed to fetch quicknotes' });
    }
});

app.get("/api/flashcards", ensureAuthenticated, async (req, res) => {
    try {
        const response = await db.query("SELECT * FROM flashcards WHERE user_id = $1 ORDER BY created_at DESC", [req.user.id]);
        res.json(response.rows);
    } catch (error) {
        console.error('Error fetching flashcards:', error);
        res.status(500).json({ error: 'Failed to fetch flashcards' });
    }
});

app.get("/api/quiz", ensureAuthenticated, async (req, res) => {
    try {
        const response = await db.query("SELECT * FROM quiz WHERE user_id = $1 ORDER BY created_at DESC", [req.user.id]);
        res.json(response.rows);
    } catch (error) {
        console.error('Error fetching quizzes:', error);
        res.status(500).json({ error: 'Failed to fetch quizzes' });
    }
});

// View saved content routes
app.get("/view-quicknote/:id", ensureAuthenticated, async (req, res) => {
    try {
        const id = req.params.id;
        const response = await db.query("SELECT topic,gradelevel,note_content FROM quicknotes WHERE id=$1 AND user_id=$2", [id, req.user.id]);
        
        if (response.rows.length === 0) {
            return res.status(404).send('Note not found');
        }
        
        const result = response.rows[0];
        res.render("quicknotes.ejs", {
            topic: result.topic,
            gradeLevel: result.gradelevel,
            content: result.note_content
        });
    } catch (error) {
        console.error('Error fetching quicknote:', error);
        res.status(500).send('Failed to load note');
    }
});

app.get("/view-flashcards/:id", ensureAuthenticated, async (req, res) => {
    try {
        const id = req.params.id;
        const currentIndex = parseInt(req.query.currentIndex) || 0;
        const showAnswer = req.query.showAnswer === 'true';
        
        const response = await db.query("SELECT topic,grade_level,card_content FROM flashcards WHERE id=$1 AND user_id=$2", [id, req.user.id]);
        
        if (response.rows.length === 0) {
            return res.status(404).send('Flashcard set not found');
        }
        
        const content = response.rows[0];
        
        req.session.flashcards = content.card_content;
        req.session.topic = content.topic;
        req.session.gradeLevel = content.grade_level;
        
        res.render("flashcards.ejs", {
            topic: content.topic,
            gradeLevel: content.grade_level,
            content: content.card_content,
            currentIndex: currentIndex,
            showAnswer: showAnswer,
            savedMessage: null
        });
    } catch (error) {
        console.error('Error fetching flashcard:', error);
        res.status(500).send('Failed to load flashcard set');
    }
});

app.get("/view-quiz/:id", ensureAuthenticated, async (req, res) => {
    try {
        const id = req.params.id;
        const response = await db.query("SELECT topic,gradeLevel,content FROM quiz WHERE id=$1 AND user_id=$2", [id, req.user.id]);
        
        if (response.rows.length === 0) {
            return res.status(404).send('Quiz not found');
        }
        
        const result = response.rows[0];
        req.session.topic = result.topic;
        req.session.gradeLevel = result.gradelevel;
        req.session.content = result.content;
        
        res.render("quiz.ejs", {
            topic: req.session.topic,
            gradeLevel: req.session.gradeLevel,
            content: req.session.content,
            showResults: false
        });
    } catch (error) {
        console.error('Error fetching quiz:', error);
        res.status(500).send('Failed to load quiz');
    }
});

// Delete content routes
app.delete("/delete-content/quicknotes/:id", ensureAuthenticated, async (req, res) => {
    try {
        const id = req.params.id;
        const result = await db.query("DELETE FROM quicknotes WHERE id=$1 AND user_id=$2 RETURNING id", [id, req.user.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Note not found' 
            });
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting quicknote:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to delete note' 
        });
    }
});

app.delete("/delete-content/flashcards/:id", ensureAuthenticated, async (req, res) => {
    try {
        const id = req.params.id;
        const result = await db.query("DELETE FROM flashcards WHERE id=$1 AND user_id=$2 RETURNING id", [id, req.user.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Flashcard set not found' 
            });
        }
        
        res.json({ 
            success: true, 
            message: 'Flashcard set deleted successfully' 
        });
    } catch (error) {
        console.error('Error deleting flashcard:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to delete flashcard set' 
        });
    }
});

app.delete("/delete-content/quiz/:id", ensureAuthenticated, async (req, res) => {
    try {
        const id = req.params.id;
        const result = await db.query("DELETE FROM quiz WHERE id=$1 AND user_id=$2 RETURNING id", [id, req.user.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Quiz not found' 
            });
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting quiz:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to delete quiz' 
        });
    }
});

