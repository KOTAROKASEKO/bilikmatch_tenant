const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {GoogleGenerativeAI} = require("@google/generative-ai");

exports.chatWithGemini = onCall({secrets: ["GEMINI_API_KEY"]},
  async (request) => {
    const apiKey = process.env.GEMINI_API_KEY;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({model: "gemini-1.5-flash"});

    const userPrompt = request.data.text;

    try {
      const result = await model.generateContent(userPrompt);
      const response = await result.response;
      return {response: response.text()};
    } catch (error) {
      console.error("AI Error:", error);
      throw new HttpsError("internal", "AI generation failed");
    }
  });