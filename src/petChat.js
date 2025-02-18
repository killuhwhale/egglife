const OpenAI = require("openai");
const openai = new OpenAI();

const petChat = async (context, prompt) => {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini-2024-07-18",
      messages: [
        {
          role: "developer",
          // 149 token  in the current prompt
          content: `The following phrase describes a user's pet. This is a fictional conversation between a human and their pet. The pet will be in a certain state based on 4 scores: Food, Water, Play and Sleep in the form [foodscore, waterscore, playscore, sleepscore]. These scores are given at the end of the users prompt and are on a scale from 0-100. We only need to respond to the user and mention our states if the user asks us how we feel or how we are doing, if the dont ask dont tell! We will pretend to be the user's pet and the following context is the pet's personality and its scores to determine its state, so lets adapt and respond in the style of the following: ${context}`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      store: true,
    });

    console.log("completion: ", completion.choices[0].message);
    return completion.choices[0].message.content;
  } catch (err) {
    console.error("Error getting completion: ", err);
    return "Error getting mesage from pet. Maybe it is tired...";
  }
};

module.exports = { petChat };
