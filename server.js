require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// Set up file upload handling using multer
const upload = multer({ dest: 'uploads/' });

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Helper function to turn file into the format Gemini expects
function fileToGenerativePart(path, mimeType) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(path)).toString("base64"),
      mimeType
    },
  };
}

// API endpoint to handle document analysis
app.post('/api/analyze', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const docType = req.body.documentType;
    if (!docType) {
      return res.status(400).json({ error: 'Missing document type' });
    }

    const filePath = req.file.path;
    const mimeType = req.file.mimetype;

    // Choose model. We use gemini-2.5-flash as it's multimodal and fast
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    let prompt = "";
    if (docType === 'payslip') {
      prompt = `Analyze this payslip and extract the following details in JSON format exactly as described.
Do NOT use Markdown formatting (like \`\`\`json). Just return the raw JSON string.
{
  "employerName": "String",
  "employerAbn": "String",
  "payPeriodEnding": "String",
  "baseIncomeYtd": "Number",
  "ytdGrossEarnings": "Number",
  "smsfContributionYtd": "Number",
  "smsfContributionPercentage": "String (e.g. 11%)",
  "smsfContributionAnnualEst": "Number",
  "smsfContributionMonthlyEst": "Number",
  "allowancesYtd": "Number",
  "commissionsYtd": "Number",
  "bonusYtd": "Number",
  "overtimeIncluded": "Boolean",
  "overtimeYtd": "Number",
  "postTaxDeductionsYtd": "Number",
  "paymentAccountLast4": "String",
  "annualGrossEstimate": "Number (Calculate the annualized gross income accurately based on available YTD data or pay periods)",
  "netPayPerPeriod": "Number (The net pay amount for this specific period)",
  "payPeriodFrequency": "String (e.g. Weekly, Fortnightly, Monthly)"
}`;
    } else if (docType === 'financials') {
      prompt = `Analyze this company financial document and extract the following details in JSON format.
Do NOT use Markdown formatting (like \`\`\`json). Just return the raw JSON string.
{
  "companyName": "String",
  "financialYearEnding": "String",
  "grossProfit": "Number",
  "netProfitAfterTax": "Number",
  "depreciationDeductible": "Number",
  "interestExpense": "Number",
  "directorsRemuneration": "Number",
  "adjustedOperatingProfit": "Number (Calculate EBITDA or Adjusted Operating Profit using the add-backs)",
  "notes": "String (Brief analysis notes)"
}`;
    } else if (docType === 'trust') {
      prompt = `Analyze this Trust Deed and extract the structural blueprint details in JSON format.
Do NOT use Markdown formatting (like \`\`\`json). Just return the raw JSON string.
{
  "smsfName": "String",
  "establishmentDate": "String",
  "governingRulesVersion": "String",
  "beneficiaries": ["String", "String"],
  "lrbaDetails": {
    "permitted": "Boolean",
    "borrowingEntity": "String"
  },
  "smsfTrustee": {
    "type": "String (Corporate or Individual)",
    "name": "String",
    "acn": "String",
    "directors": ["String", "String"]
  },
  "bareTrustee": {
    "type": "String (Corporate or Individual)",
    "name": "String",
    "acn": "String",
    "directors": ["String", "String"]
  }
}`;
    } else {
      return res.status(400).json({ error: 'Invalid document type' });
    }

    const imageParts = [
      fileToGenerativePart(filePath, mimeType),
    ];

    const result = await model.generateContent([prompt, ...imageParts]);
    const response = await result.response;
    const text = response.text();

    // Clean up temporary file
    fs.unlinkSync(filePath);

    // Remove potential markdown code blocks if the AI still included them
    let cleanJson = text;
    if (cleanJson.startsWith('```json')) {
      cleanJson = cleanJson.slice(7, -3);
    } else if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.slice(3, -3);
    }

    try {
      const parsedData = JSON.parse(cleanJson.trim());
      res.json({ success: true, data: parsedData, filename: req.file.originalname, docType });
    } catch (parseError) {
      console.error("Failed to parse Gemini output:", text);
      res.status(500).json({ error: 'Failed to parse AI output. Result might be malformed.', rawText: text });
    }

  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({
      error: 'An error occurred during document analysis.',
      details: error.message,
      stack: error.stack ? error.stack.split('\n')[0] : "No stack trace available"
    });
  }
});

// Create uploads folder if it doesn't exist
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
