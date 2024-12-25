const axios = require("axios");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const OpenAI = require("openai");
const openai = new OpenAI();

const FormData = require("form-data");

const STABILITY_KEY = "sk-BKryqLzVQy6Itf1FMYuX7FptQ7WPm2FqgcdcxzXHVEspDgCm";
const STORAGE_URL =
  "https://storage.googleapis.com/petlife-15761.firebasestorage.app/";
const GDRIVE_URL = "https://drive.usercontent.google.com/download?id=";

// Function to download an image from a URL
async function downloadImage(imageID, outputPath) {
  const baseurl = imageID.startsWith("UGC") ? STORAGE_URL : GDRIVE_URL;
  const imgURL = `${baseurl}${imageID}`;
  console.log("Downloading image id: ", imgURL);
  const response = await axios({
    url: imgURL,
    method: "GET",
    responseType: "stream", // Stream the response
  });

  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

async function askGPT(prompt, localImagePath, localResizeMaskPath) {
  const response = await openai.images.edit({
    model: "dall-e-2",
    image: fs.createReadStream(localImagePath),
    mask: fs.createReadStream(localResizeMaskPath),
    prompt: prompt,
    response_format: "url", //b64_json
    size: "256x256",
  });

  const alteredURL = response.data[0].url;
  console.log("Altered img url: ", alteredURL);
  console.log("Response: ", response.data);
  return alteredURL;
}
async function askStability(prompt, localImagePath, localResizeMaskPath) {
  const payload = {
    image: fs.createReadStream(localImagePath),
    mask: fs.createReadStream(localResizeMaskPath),
    prompt: "dog wearing black glasses",
    output_format: "png",
  };

  const response = await axios.postForm(
    `https://api.stability.ai/v2beta/stable-image/edit/inpaint`,
    axios.toFormData(payload, new FormData()),
    {
      validateStatus: undefined,
      responseType: "arraybuffer",
      headers: {
        Authorization: `Bearer ${STABILITY_KEY}`,
        Accept: "image/*",
      },
    }
  );
  console.log("Response: ", response);
  if (response.status === 200) {
    console.log("Succes!");
    fs.writeFileSync("./stabiltiy_tmp.png", Buffer.from(response.data));
    return response.data;
  } else {
    console.log(`${response.status}: ${response.data.toString()}`);
  }
  console.log("Failed!");
  return null;
}

// Function to generate an image variation
async function createImageVariation(imageID, mask, prompt) {
  try {
    // Step 1: Download the image
    const localImagePath = path.resolve(__dirname, "temp_image.png");
    const localMaskPath = path.resolve(__dirname, "temp_mask.png");
    const localResizeMaskPath = path.resolve(
      __dirname,
      "localResizeMaskPath.png"
    );

    await downloadImage(imageID, localImagePath);
    await saveMask(mask, localMaskPath);
    await scaleImageToMatchTarget(
      localImagePath,
      localMaskPath,
      localResizeMaskPath
    );
    console.log(`Image downloaded to ${localResizeMaskPath}`);
    console.log("Altering w/ prompt: ", prompt);

    const alteredUrl = await askGPT(
      prompt,
      localImagePath,
      localResizeMaskPath
    );
    // await askStability(prompt, localImagePath, localResizeMaskPath);
    return alteredUrl;
  } catch (error) {
    console.error(
      "Error creating image variation:",
      error.response?.data || error.message
    );
  }
  return;
}

async function saveMask(maskb64, outputPath) {
  const base64Data = maskb64.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");

  // Write the buffer to a file
  fs.writeFile(outputPath, buffer, (err) => {
    if (err) {
      console.error("Error saving the image:", err);
    } else {
      console.log(`Image saved successfully at: ${outputPath}`);
    }
  });
}

async function scaleImageToMatchTarget(targetImgPath, inputPath, outputPath) {
  try {
    // Load the target image metadata to determine its size
    const targetMetadata = await sharp(targetImgPath).metadata();
    const targetWidth = targetMetadata.width;
    const targetHeight = targetMetadata.height;

    if (!targetWidth || !targetHeight) {
      throw new Error("Target image dimensions could not be determined.");
    }

    // Load the input image metadata to determine its size
    const inputMetadata = await sharp(inputPath).metadata();

    if (!inputMetadata.width || !inputMetadata.height) {
      throw new Error("Input image dimensions could not be determined.");
    }

    // Calculate the scale to fit within target dimensions
    const widthScale = targetWidth / inputMetadata.width;
    const heightScale = targetHeight / inputMetadata.height;
    const scale = Math.min(widthScale, heightScale); // Scale to fit within the target dimensions

    const newWidth = Math.round(inputMetadata.width * scale);
    const newHeight = Math.round(inputMetadata.height * scale);

    // Resize the image and pad it to match the target image dimensions
    await sharp(inputPath)
      .resize(newWidth, newHeight, { fit: "inside" })
      .extend({
        top: Math.floor((targetHeight - newHeight) / 2),
        bottom: Math.ceil((targetHeight - newHeight) / 2),
        left: Math.floor((targetWidth - newWidth) / 2),
        right: Math.ceil((targetWidth - newWidth) / 2),
        background: { r: 0, g: 0, b: 0, alpha: 0 }, // Transparent padding
      })
      .toFile(outputPath);

    console.log(
      `Image successfully scaled to match target and saved to: ${outputPath}`
    );
  } catch (error) {
    console.error(`Failed to scale image: ${error.message}`);
  }
}

module.exports = { createImageVariation };
