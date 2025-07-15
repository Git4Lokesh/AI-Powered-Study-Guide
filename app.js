import axios from "axios";
import bodyParser from "body-parser";
import express from "express";
import { marked } from "marked";
import session from "express-session";
import dotenv from "dotenv";
import multer from 'multer';
import FormData from 'form-data';
dotenv.config();

const app = express();
const port = 3000;

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
    cookie: { secure: false }
}));

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


app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

app.get("/", (req, res) => {
    res.render("dashboard.ejs");
});

app.post("/generate", upload.single('document'), async (req, res) => {
    const topic = req.body.topic;
    const level = req.body.gradeLevel;
    const type = req.body.studyType;
    const method = req.body.inputMethod;
    
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
    
    // Remove both processMathContent() and marked() processing
    res.render("quicknotes.ejs", {
        topic: "Course Material Analysis",
        gradeLevel: level,
        content: response.data.choices[0].message.content  // Direct content like flashcards
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

app.post("/flashcard", (req, res) => {
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

app.post("/quiz", async (req, res) => {
    var showResults = true;
    var userAnswers = [];
    userAnswers.push(req.body.answer_0);
    userAnswers.push(req.body.answer_1);
    userAnswers.push(req.body.answer_2);
    userAnswers.push(req.body.answer_3);
    userAnswers.push(req.body.answer_4);
    userAnswers.push(req.body.answer_5);
    userAnswers.push(req.body.answer_6);
    userAnswers.push(req.body.answer_7);
    userAnswers.push(req.body.answer_8);
    userAnswers.push(req.body.answer_9);
    var score = 0;
    if(req.body.answer_0===req.session.content[0].answer)
        score++;
    if(req.body.answer_1===req.session.content[1].answer)
        score++;
    if(req.body.answer_2===req.session.content[2].answer)
        score++;
    if(req.body.answer_3===req.session.content[3].answer)
        score++;
    if(req.body.answer_4===req.session.content[4].answer)
        score++;
    if(req.body.answer_5===req.session.content[5].answer)
        score++;
    if(req.body.answer_6===req.session.content[6].answer)
        score++;
    if(req.body.answer_7===req.session.content[7].answer)
        score++;
    if(req.body.answer_8===req.session.content[8].answer)
        score++;
    if(req.body.answer_9===req.session.content[9].answer)
        score++;

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
- If referencing mathematical concepts, use $$...$$ notation`;

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
    
    // Process mathematical content in the analysis
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
})
app.post('/api/expand-text', async (req, res) => {
    try {
        const { text, type, prompt, topic, gradeLevel } = req.body;
        
        const response = await axios.post("https://api.perplexity.ai/chat/completions", {
            model: "sonar",
            messages: [
                {
                    role: "system",
                    content: "You are an expert educator providing detailed explanations for study materials. Use proper LaTeX formatting for mathematical expressions."
                },
                {
                    role: "user",
                    content: `${prompt}

Context: This is from study notes about "${topic}" for ${gradeLevel} level students from a previous prompt, you have to provide additional explanation.

FORMATTING REQUIREMENTS: 
-RETURN HTML FORMATTED CONTENT (use <p>, <strong>, <ul> tags and etcetera)
- Use LaTeX notation for math : $$ delimiters
-Keep responses concise
-Use HTML formatting for emphasis and structure
-No markdown formatting,only HTML tags

Please provide a comprehensive response that:
- Is appropriate for ${gradeLevel} level understanding
- Uses proper formatting including LaTeX for mathematical expressions surrounded by $$.
- Provides clear, educational explanations
- Includes relevant examples where helpful
- As this is further context, be extremely concise and quick to the point. Should not exceed 100 words.
- Do not delve into irrelevant topics, do exactly what is needed.

Text to expand: "${text}"`
                }
            ]
        }, {
            headers: {
                Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`
            }
        });

        const expansion = response.data.choices[0].message.content;
        
        res.json({ expansion });
    } catch (error) {
        console.error('Text expansion error:', error);
        res.status(500).json({ error: 'Failed to generate expansion' });
    }
});

