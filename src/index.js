const express = require("express");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");
const cron = require("node-cron");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const http2 = require("http2");
const jwt = require("jsonwebtoken");
const util = require("util");

const imagen = require("./imageGen");
const PetChat = require("./petChat");

require("log-timestamp")(function () {
  const now = new Date();
  const options = {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  };
  const formatter = new Intl.DateTimeFormat("en-US", options);
  const formattedDate = formatter.format(now);
  return `${formattedDate} - %s`;
});

const app = express();
const PORT = 3005;

const APNKEYID = "M33FAQMH3G";
const TEAMID = "NS279G83V7";
const APNPrivatekey = "./src/APN_AuthKey_M33FAQMH3G.p8";

// Configuration
const scoreTimerDec = `* */6 * * *`; // Every 6 hours
const scoreTimerCheck = `* * */2 * * *`;
const ageTimer = `0 6 * * *`; // 6am everyday

const FOOD = "FOOD";
const PLAY = "PLAY";
const SLEEP = "SLEEP";
const WATER = "WATER";

const SCOREMULTI = 1;

// Every 2 hours, we lower the scores by this amount
const SCOREDECS = {
  [SLEEP]: 1 * SCOREMULTI,
  [FOOD]: 4 * SCOREMULTI,
  [WATER]: 5 * SCOREMULTI,
  [PLAY]: 7 * SCOREMULTI,
};

const SCORE_LIM_MULTI = 2;

const SCORELIMS = {
  [SLEEP]: 1 * SCORE_LIM_MULTI,
  [FOOD]: 4 * SCORE_LIM_MULTI,
  [WATER]: 5 * SCORE_LIM_MULTI,
  [PLAY]: 7 * SCORE_LIM_MULTI,
};

const SKIP_CATS = ["APNTokens", "POINTS", "TEST", "AGE"];

const JWT_FILE_PATH = path.resolve(__dirname, "apns_jwt_token.json"); // Path to store the token
const JWT_EXPIRATION_SECONDS = 60 * 60; // 1 hour (Apple requires tokens to be valid for up to 1 hour)
const LOCK_FILE_PATH = path.resolve(__dirname, "jwt_token.lock"); // Path to the lock file

// Promisify fs functions
const writeFile = util.promisify(fs.writeFile);
const readFile = util.promisify(fs.readFile);
const unlink = util.promisify(fs.unlink);

// ########################################################
// ########################################################
// ########################################################
// ########################################################
// ########################################################
// ########################################################
// ########################################################
// ########################################################

/// Helper: Wait for lock
const waitForLock = async (lockFilePath) => {
  while (fs.existsSync(lockFilePath)) {
    await new Promise((resolve) => setTimeout(resolve, 50)); // Wait 50ms before checking again
  }
};

/// Helper: Create lock
const createLock = async (lockFilePath) => {
  if (!fs.existsSync(lockFilePath)) {
    fs.writeFileSync(lockFilePath, "LOCK");
  }
};

/// Helper: Remove lock
const removeLock = async (lockFilePath) => {
  if (fs.existsSync(lockFilePath)) {
    await unlink(lockFilePath);
  }
};

/// Generate a new JWT
const generateNewJWT = () => {
  const issueTime = Math.floor(Date.now() / 1000);

  const header = {
    alg: "ES256",
    kid: APNKEYID,
  };

  const claims = {
    iss: TEAMID,
    iat: issueTime,
  };

  const privateKey = fs.readFileSync(APNPrivatekey, "utf8");

  return jwt.sign(claims, privateKey, {
    algorithm: "ES256",
    header,
  });
};

/// Save JWT to file
const saveJWTToFile = async (token) => {
  await createLock(LOCK_FILE_PATH);
  try {
    await writeFile(
      JWT_FILE_PATH,
      JSON.stringify({ token, createdAt: Date.now() })
    );
  } finally {
    await removeLock(LOCK_FILE_PATH);
  }
};

/// Load JWT from file
const loadJWTFromFile = async () => {
  await waitForLock(LOCK_FILE_PATH); // Wait if the file is locked
  if (!fs.existsSync(JWT_FILE_PATH)) {
    return null;
  }

  const fileContent = await readFile(JWT_FILE_PATH, "utf8");
  return JSON.parse(fileContent);
};

/// Refresh JWT
const refreshJWT = async () => {
  const newToken = generateNewJWT();
  await saveJWTToFile(newToken);
  return newToken;
};

/// Get the current JWT, refreshing if necessary
const getAuthToken = async () => {
  await waitForLock(LOCK_FILE_PATH); // Wait if another process is working

  let jwtData = await loadJWTFromFile();

  if (
    !jwtData ||
    Date.now() - jwtData.createdAt > JWT_EXPIRATION_SECONDS * 1000
  ) {
    console.log("JWT expired or missing. Refreshing...");
    const newToken = generateNewJWT();
    await saveJWTToFile(newToken);
    return newToken;
  }

  return jwtData.token;
};

const getUserTokens = async (userId) => {
  const db = admin.database();
  const ref = db.ref(`APNTokens/${userId}`);
  const snapshot = await ref.once("value");
  if (snapshot.exists()) {
    return Object.values(snapshot.val());
  } else {
    return [];
  }
};

async function sendPushNotifications(uid, alert) {
  const authToken = await getAuthToken();
  const userTokens = await getUserTokens(uid);

  if (userTokens.length == 0) {
    return console.log("No device tokens for user: ", uid);
  }

  console.log(`Sending ${userTokens.length} notifications to user ${uid}`);

  for (let deviceToken of userTokens) {
    try {
      const res = await sendPushNotification(authToken, alert, deviceToken);
      console.log("Notficaiton result: ", res, alert);
    } catch (err) {
      console.log("Failed to send push notifications", err);
    }
  }
}

async function sendPushNotification(
  authToken,
  alert,
  deviceToken,
  attempt = 0
) {
  return new Promise((resolve, reject) => {
    const client = http2.connect("https://api.development.push.apple.com:443");

    // Create the HTTP/2 request headers
    const headers = {
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${authToken}`,
      "apns-topic": "com.killuhwhale.egglife.watchkitapp",
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": "0",
    };

    // Create the payload
    const payload = JSON.stringify({
      aps: {
        alert: {
          title: alert.title,
          subtitle: alert.subtitle,
          body: alert.body,
        },
      },
    });

    // Create the request
    const req = client.request(headers);

    // Handle response
    req.on("response", (headers, flags) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
      });
      req.on("end", async () => {
        console.log("Noti onEnd: ", deviceToken, headers, data);

        if (headers[":status"] === 200) {
          resolve({ success: true, response: data });
        } else if (headers[":status"] === 403) {
          console.log("JWT expired. Refreshing token...");
          authToken = await refreshJWT();

          // Retry the notification with the new token
          if (attempt < 1) {
            console.log("Retrying noti");
            sendPushNotification(authToken, alert, deviceToken, attempt++);
          }
        } else {
          reject({ success: false, status: headers[":status"], error: data });
        }
        client.close();
      });
    });

    req.on("error", (err) => {
      reject({ success: false, error: err.message });
      client.close();
    });

    // Write the payload
    req.write(payload);
    req.end();
  });
}

// Example usage

// curl -X POST http://localhost:3000/generateCustomToken \
// -H "Content-Type: application/json" \
// -d '{"idToken": "YOUR_FIREBASE_ID_TOKEN"}'

admin.initializeApp({
  credential: admin.credential.cert(
    require("./petlife-15761-firebase-adminsdk-he02j-c2c6e9d51b.json")
  ),
  databaseURL: "https://petlife-15761-default-rtdb.firebaseio.com",
  storageBucket: "gs://petlife-15761.firebasestorage.app",
});

const db = admin.database(); // Firebase Realtime Database reference

var storageRef = admin.storage().bucket();

// ########################################################
// ########################################################
// ########################################################
// ########################################################
// ########################################################
// ########################################################
// ########################################################
// ########################################################
// ########################################################
// ########################################################

// Middleware to parse JSON bodies
app.use(bodyParser.json());
app.post("/IAP", async (req, res) => {
  console.log("In app purchase req.body: ", req.body);
  return res.json({ message: "success!" });
});

app.post("/generateImage", async (req, res) => {
  // Save to Google Drive Folder - User Generated Content: 1CnRt2mP-lmFiebto_zW_RsQSOeEi6hke
  // TODO()
  try {
    console.log("Generating image");
    console.log(req.body);
    const prompt = req.body["prompt"];
    const url = req.body["imageID"];
    const mask = req.body["mask"];
    const alteredUrl = await imagen.createImageVariation(url, mask, prompt);
    res.json({ url: alteredUrl });
  } catch (err) {
    console.log("Error generating image: ", err);
  }
});

app.post("/saveGeneratedImage", async (req, res) => {
  try {
    // TODO() Update and get the userID and PET index from the request.
    const url = req.body.alteredURL;
    const userID = req.body.userID;
    const petIndex = req.body.petIndex;
    if (!url) {
      return res.status(400).json({ error: "alteredURL is required" });
    }

    console.log("Downloading image from URL:", url);

    // 1. Download the image
    const response = await axios.get(url, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data, "binary");
    const fileName = `image_${Date.now()}.png`;
    const tempFilePath = path.join(__dirname, fileName);

    // Save the file temporarily to disk
    fs.writeFileSync(tempFilePath, buffer);

    console.log("Image downloaded successfully:", fileName);

    // 2. Upload the file to Firebase Storage
    //TODO() Update the dest path to UGC/userID/Petindex/fileName
    const destinationPath = `UGC/${userID}/${petIndex}/${fileName}`; // Specify your folder in storage
    // let ugcRef = storageRef.child(destinationPath);
    const upRes = await storageRef.upload(tempFilePath, {
      destination: destinationPath,
    });

    console.log("Image uploaded to Firebase Storage:", destinationPath, upRes);

    // Generate a public URL for the uploaded file
    // const publicUrl = `https://storage.googleapis.com/${storage.name}/${destinationPath}`;
    // console.log("Public URL:", publicUrl);

    // 3. Clean up temporary file
    fs.unlinkSync(tempFilePath);

    // Return the public URL as the response
    return res.status(200).json({ imageID: destinationPath });
  } catch (error) {
    console.error("Error uploading file to Firebase Storage:", error.message);
    return res.status(500).json({ error: "Failed to upload image" });
  }
});

app.post("/petChat", async (req, res) => {
  try {
    const userID = req.body.userID;
    const petIndex = req.body.petIndex;
    const context = req.body.context;
    const message = req.body.message;
    const history = req.body.history;
    // Eventually try to store chat messages... at least for 48hrs?

    const pet_message = await PetChat.petChat(context, message, history);
    return res.json({ message: pet_message });
  } catch (err) {
    console.log("Error petChat: ", err);
  }

  return res.json({ message: "Failed to get pet message." });
});

//TODO implement deleteUserGeneratedImages
app.post("/deleteUserGeneratedImages", async (req, res) => {
  try {
    // Extract userID and petIndex from the request body.
    const userID = req.body.userID;
    const petIndex = req.body.petIndex;

    if (!userID || !petIndex) {
      return res
        .status(400)
        .json({ error: "userID and petIndex are required" });
    }

    // Construct the folder path. Note the trailing slash.
    const folderPath = `UGC/${userID}/${petIndex}/`;
    console.log("Deleting images under folder:", folderPath);

    // Delete all files under the folder. This uses the bucket's deleteFiles method.
    // Ensure that storageRef is your Firebase Storage bucket reference.
    await storageRef.deleteFiles({
      prefix: folderPath,
    });

    console.log("Images deleted successfully from:", folderPath);
    return res.status(200).json({ message: "Images deleted successfully" });
  } catch (error) {
    console.error("Error deleting user generated images:", error.message);
    return res.status(500).json({ error: "Failed to delete images" });
  }
});

// Verify ID Token and Generate Custom Token
app.post("/generateCustomToken", async (req, res) => {
  const { idToken } = req.body;
  console.log("Generating token");
  if (!idToken) {
    return res.status(400).json({ error: "ID token is required" });
  }

  try {
    // Verify the provided ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    // console.log("Decoded Token:", decodedToken);

    // Extract UID from the ID token
    const uid = decodedToken.uid;

    // Optionally, add custom claims (e.g., role or permissions)
    const customClaims = { role: "watch" };

    // Generate a custom token
    const customToken = await admin.auth().createCustomToken(uid, customClaims);
    console.log("Generated Custom Token:", customToken);
    // await initializeUser(uid);
    await initializeUserPoints(uid);

    // Respond with the custom token
    res.status(200).json({ customToken });
  } catch (error) {
    console.error(
      "Error verifying ID token or generating custom token:",
      error
    );
    res.status(500).json({ error: "Failed to generate custom token" });
  }
});

// Health check endpoint
app.get("/", (req, res) => {
  res.send("Firebase Custom Token Service is running!");
});

// Start the Express server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);

  // **Service 1**: Decrease all numbers by X every 10 seconds
  cron.schedule(scoreTimerDec, () => {
    console.log("Running decreaseValuesByX service...");
    decreaseValuesByX(); // Adjust the value of X as needed
    checkValuesBelowY();
  });

  // Schedule the incrementAge service to run every 20 minutes
  cron.schedule(ageTimer, () => {
    console.log("Running incrementAge service...");
    incrementAgeForAllPets();
  });
});

// ########################################################
// ########################################################
// ########################################################
// ########################################################
// ########################################################
// ########################################################
// ########################################################
// ########################################################
// ########################################################

// **Service 1**: Decrease all numbers by X periodically
function decreaseValuesByX() {
  const rootRef = db.ref(); // Get the root reference

  rootRef.once("value", (snapshot) => {
    const data = snapshot.val();

    if (!data) {
      console.log("No data found in the database.");
      return;
    }

    // Iterate through all categories (e.g., FOOD, PLAY, SLEEP, WATER)
    for (const category in data) {
      if (SKIP_CATS.indexOf(category) >= 0) continue;

      const users = data[category];
      for (const userId in users) {
        const pets = users[userId]["PETS"];
        for (const petId in pets) {
          const currentValue = pets[petId];
          const x = SCOREDECS[category];
          if (typeof currentValue === "number") {
            const newValue = Math.max(0, currentValue - x); // Ensure value doesn't go below 0
            if (currentValue <= 0) {
              // console.log("Cant dec, value: ", newValue, currentValue);
              continue;
            }

            db.ref(`${category}/${userId}/PETS/${petId}`).set(newValue);
            // console.log(
            //   `Updated ${category}/${userId}/PETS/${petId}: ${currentValue} -> ${newValue}`
            // );
          }
        }
      }
    }
  });
}

// **Service 2**: Check for values below Y and send notifications (or log to console)
function checkValuesBelowY() {
  const rootRef = db.ref(); // Get the root reference

  rootRef
    .get()
    .then((snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        console.log("checkValuesBelowY snapshot: ");

        if (!data) {
          console.log("No data found in the database.");
          return;
        }

        // Extract all users from the first category
        const categories = Object.keys(data);
        if (categories.length === 0) {
          console.log("No categories found.");
          return;
        }

        const firstCategory = categories[0];
        const users = Object.keys(data[firstCategory]);

        // Iterate by user
        for (const userId of users) {
          let userAlerts = []; // Collect all alerts for this user

          // Iterate by category for the current user
          for (const category of categories) {
            if (SKIP_CATS.indexOf(category) >= 0) continue;

            const usersInCategory = data[category];
            const userPets = usersInCategory[userId]?.PETS;

            if (!userPets) {
              console.log(
                `No pets found for user ${userId} in category ${category}.`
              );
              continue;
            }

            // Check values for each pet
            for (const petId in userPets) {
              const currentValue = userPets[petId];
              const y = SCORELIMS[category];

              if (typeof currentValue === "number" && currentValue < y) {
                const alert = `${category}: ${currentValue}/${y}`;
                userAlerts.push(alert);
              }
            }
          }

          // Send a single notification for the user if there are alerts
          if (userAlerts.length > 0) {
            const notification = {
              title: `Your pet needs attention!`,
              subtitle: `Critical values detected.`,
              body: userAlerts.join("; "),
            };

            try {
              sendPushNotifications(userId, notification);
              console.log(`Notification sent to ${userId}:`, notification);
            } catch (err) {
              console.error("Error sending notification: ", notification, err);
            }
          }
        }
      } else {
        console.log("No data available");
      }
    })
    .catch((error) => {
      console.error("Error fetching data: ", error);
    });
}

// Increment AGE for all pets dynamically
function incrementAgeForAllPets() {
  const rootPath = "AGE"; // Start at the root path for AGE

  // Fetch the entire AGE node
  db.ref(rootPath).once("value", (snapshot) => {
    const data = snapshot.val();

    if (!data) {
      console.log("No data found in the AGE path.");
      return;
    }

    // Traverse through all users
    for (const userId in data) {
      const pets = data[userId]["PETS"];

      // Traverse through all pets for the user
      for (const petId in pets) {
        const currentAge = pets[petId];

        if (typeof currentAge === "number") {
          const newAge = currentAge + 1; // Increment age by 1
          const petPath = `${rootPath}/${userId}/PETS/${petId}`; // Construct the full path
          db.ref(petPath).set(newAge); // Update the database
          console.log(`Updated AGE at ${petPath}: ${currentAge} -> ${newAge}`);
        } else {
          // console.log(
          //   `No valid number found at path: ${rootPath}/${userId}/PETS/${petId}`
          // );
        }
      }
    }
  });
}

async function initializeUserPoints(uid) {
  try {
    const paths = ["POINTS"];

    const initialValues = 1337; // Default starting value

    // Iterate over each path and check/create data for the user
    for (const path of paths) {
      const userPath = `${path}/${uid}`;
      const ref = db.ref(userPath);

      // Check if the field already exists
      const snapshot = await ref.once("value");

      if (!snapshot.exists()) {
        // Create the field if it doesn't exist

        await ref.set(initialValues);

        console.log(
          `Initialized ${path} for user ${uid}: ${petId} -> ${initialValues}`
        );
      } else {
        console.log(`${path} already exists for user ${uid}`);
      }
    }

    console.log(`Initialization complete for user ${uid}`);
  } catch (error) {
    console.error("Error initializing user fields:", error);
  }
}
