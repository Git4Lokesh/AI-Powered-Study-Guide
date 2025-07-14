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

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set('view engine', 'ejs');
app.set('views', './views');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
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
                            "content": "You are an expert educator. Create study materials in a direct, textbook-like format. Never show your research process or mention search results. Start directly with the educational content."
                        },
                        {
                            "role": "user",
                            "content": `Write extremely thorough study notes on ${topic} for ${level} level students. The student should be able to revise this for exams.

Format Requirements:
- Start with a clear definition
- Use headings and subheadings
- Include bullet points for key concepts
- Add practical examples
- No meta-commentary about sources
- No phrases like "based on the search results"
- If mathematical in nature, sprinkle in example numericals here and there

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
                    content: marked(response.data.choices[0].message.content)
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
                            "content": "Create flashcards in JSON format. Return only a JSON array of objects with 'question' and 'answer' properties."
                        },
                        {
                            "role": "user",
                            "content": `Generate 10 flashcards for ${topic} at ${level} school level. Format as JSON array: [{"question": "...", "answer": "..."}].- No meta-commentary about sources
- No phrases like "based on the search results"`
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
            // Quiz logic for topic input
            try {
                const response = await axios.post("https://api.perplexity.ai/chat/completions", {
                    model: "sonar-pro",
                    messages: [
                        {
                            "role": "system",
                            "content": "You are an expert educational content creator. Generate quiz questions in strict JSON format. Return ONLY a valid JSON array with no additional text, explanations, or formatting. Each question must have exactly 4 distinct, plausible options with one clearly correct answer."
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
                                - ONLY IF the topic is mathematical in nature or could have calculation based questions, sprinkle in 3-4 questions which involve calculations.

                            Example format:
                            [
                                {
                                    "question": "What is the main purpose of linear regression?",
                                    "option1": "To create curved relationships between variables",
                                    "option2": "To find the best straight line through data points", 
                                    "option3": "To categorize data into groups",
                                    "option4": "To remove outliers from datasets",
                                    "answer": "option2"
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
                            "content": "You are an expert educator specializing in analyzing comprehensive academic course materials. The content provided has been extracted using advanced parsing that captures visual elements, mathematical notation, and structured data. Transform this rich content into well-organized study notes."
                        },
                        {
                            "role": "user",
                            "content": `Transform the following comprehensive course material into detailed and extemely thorough study notes for ${level} level students. This content includes properly extracted text, mathematical formulas, table data, and descriptions of visual elements.

COMPREHENSIVE COURSE MATERIAL:
${extractedText}

Create study notes with these requirements:
- Start with a clear overview/definition section
- Use clear headings and subheadings to organize concepts
- Include bullet points for key concepts and important details
- Preserve and properly format any mathematical formulas or equations
- Include information from tables and charts mentioned in the content
- Reference visual elements (graphs, diagrams) with proper context
- Add explanatory context to connect different sections
- Structure content logically for exam preparation
- Use ${level}-appropriate language and explanations
- Focus on the most important concepts for understanding and retention

Format: Use markdown formatting with proper headers, bullet points, and emphasis.`
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
                    content: marked(response.data.choices[0].message.content)
                });
            }
            else if (type === "flashcards") {
                const response = await axios.post("https://api.perplexity.ai/chat/completions", {
                    "model": "sonar",
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are an expert educator creating flashcards from comprehensive course material that includes properly extracted text, mathematical notation, table data, and visual element descriptions. Return only a JSON array of objects with 'question' and 'answer' properties."
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
-Return only a valid JSON array.
-Do not include any Markdown code fences, explanations, or extra text.
-Output must start directly with '[' and end with ']'.
-Generate exactly 10 flashcards covering the most essential content from this material.`
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
                    model: "sonar",
                    messages: [
                        {
                            "role": "system",
                            "content": "You are an expert educational assessment creator analyzing comprehensive course material with properly extracted mathematical notation, table data, and visual element descriptions. Generate quiz questions in strict JSON format. Return ONLY a valid JSON array with no additional text, explanations, or formatting."
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

Generate exactly 10 questions covering the essential content from this course material.`
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
- Do NOT use Markdown syntax (##, -, **) - use actual HTML tags only`;

    const analysis = await axios.post("https://api.perplexity.ai/chat/completions",{
        model:"sonar-pro",
        messages:[
            {
                role:"system",
                content:"You are an expert educator in "+req.session.topic+". Analyze quiz data and provide actiononable insights."
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
    
    res.render("quiz.ejs",{
        topic:req.session.topic,
        gradeLevel:req.session.gradeLevel,
        content:req.session.content,
        showResults:showResults,
        userAnswers:userAnswers,
        score:score,
        performanceAnalysis: analysis.data.choices[0].message.content
    })
})
