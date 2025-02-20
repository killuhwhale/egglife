const OpenAI = require("openai");
const openai = new OpenAI();

const inputRate = 0.15 / 1_000_000;
const outputRate = 0.6 / 1_000_000;

const cost = inputRate * 160 + outputRate * 201;
// 0.0001446

// Dall-e cost per 256 image
// 0.016

// User  buys $11.76 ($10 to dev) in-app purchase for 10,000.00 points

// In App Purchase 15% tax

// 750 points  = 1 image
// 100 points = 1 message

// 1 point ==> $0.001 to dev
// 1 point ==> $0.001176 to user

const SCORE_THRESH_FOOD = 60;
const SCORE_THRESH_WATER = 75;
const SCORE_THRESH_PLAY = 35;
const SCORE_THRESH_SLEEP = 20;

const thresholds = [
  SCORE_THRESH_FOOD,
  SCORE_THRESH_WATER,
  SCORE_THRESH_PLAY,
  SCORE_THRESH_SLEEP,
];

const petChat = async (context, prompt, history) => {
  try {
    const messages = [
      {
        role: "developer", // Open AI
        // role: "system", // Grok
        content: `The following phrase describes a user's pet. This is a fictional conversation between a human and their pet. The pet will be in a certain state based on 4 scores: Food, Water, Play and Sleep in the form [foodscore, waterscore, playscore, sleepscore]. These scores are given at the end of the users prompt and are on a scale from 0-100 the thresholds will be placed at the end. When the scores are above the thresholds, the pet is very satisfied. We only need to respond to the user and mention our states if the user asks us how we feel or how we are doing, if the dont ask dont tell! We will pretend to be the user's pet and the following context is the pet's personality and its scores to determine its state, so lets adapt and respond in the style of the following: ${context} Thresholds: ${thresholds}`,
      },
      ...(history || []),
      {
        role: "user",
        content: prompt,
      },
    ];

    console.log("messages: ", messages);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini-2024-07-18",
      // model: "grok-2-latest",
      messages: messages,
      store: true,
    });

    console.log("completion: ", completion);
    console.log("completion: ", completion.choices[0].message);
    return completion.choices[0].message;
  } catch (err) {
    console.error("Error getting completion: ", err);
    return "Error getting mesage from pet. Maybe it is tired...";
  }
};

module.exports = { petChat };
