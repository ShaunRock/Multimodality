const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const {
  GoogleAIFileManager,
  FileState,
} = require("@google/generative-ai/server");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const os = require("os");

const upload = multer();
const app = express();
const port = process.env.PORT || 8000;

// Use cors middleware
app.use(cors());
app.use(express.json()); // Parse JSON bodies

// Initialize Google Generative AI SDK
const apiKey =
  process.env.GEMINI_API_KEY || "AIzaSyB2-oXWZf03YfxRmKMdIgqTMpUgIeqsxoE";
const genAI = new GoogleGenerativeAI(apiKey);
const fileManager = new GoogleAIFileManager(apiKey);

// Converts local file information to a GoogleGenerativeAI.Part object.
function fileToGenerativePart(file) {
  return {
    fileData: {
      fileUri: file.uri,
      mimeType: file.mimeType,
    },
  };
}

function extractTextPromptFromFile(fileName) {
  // Parse file name to extract text prompt
  const parts = fileName.split("_");
  return parts[0];
}

app.post("/", upload.array("files", 10), async (req, res) => {
  try {
    const { files } = req;

    if (!files || files.length === 0) {
      console.log("No files uploaded");
      return res.status(400).json({ error: "No files uploaded" });
    }

    const concatenatedParts = [];
    const tempDir = path.join(os.tmpdir(), "temp");

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const tempFilePath = path.join(tempDir, file.originalname);

      fs.writeFileSync(tempFilePath, file.buffer);

      const uploadResult = await fileManager.uploadFile(tempFilePath, {
        mimeType: file.mimetype,
      });

      let fileData = await fileManager.getFile(uploadResult.file.name);
      while (fileData.state === FileState.PROCESSING) {
        process.stdout.write(".");
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        fileData = await fileManager.getFile(uploadResult.file.name);
      }

      if (fileData.state === FileState.FAILED) {
        throw new Error("File processing failed.");
      }

      concatenatedParts.push(fileToGenerativePart(fileData));

      const textPrompt = extractTextPromptFromFile(file.originalname);
      concatenatedParts.push({
        text: textPrompt || "Tell me what this is about?",
      });

      fs.unlinkSync(tempFilePath);
    }

    const prompt = "Please describe the following media:";
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent([prompt, ...concatenatedParts]);
    const response = result.response;
    const text = response.text();

    console.log("Generated text:", text);

    res.json(text);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
