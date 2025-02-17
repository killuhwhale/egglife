const OpenAI = require("openai");
const openai = new OpenAI();

const petChat = async (context, prompt) => {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini-2024-07-18",
      messages: [
        {
          role: "developer",
          content: `The following phrase describes a user's pet. This is a fictional conversation between a human and their pet. We will pretend to be the user's pet and the following context is the pet's personality so lets adapt and respond in the style of the following: ${context}`,
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
