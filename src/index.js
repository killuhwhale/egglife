const express = require("express");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");
const cron = require("node-cron");

const app = express();
const PORT = 3001;

const apn = require("apn");

// Initialize the APNs provider with your `.p8` key
const apnProvider = new apn.Provider({
  token: {
    key: "./src/APN_AuthKey_M33FAQMH3G.p8", // Path to the .p8 file
    keyId: "M33FAQMH3G", // The Key ID from Apple Developer Portal
    teamId: "NS279G83V7", // The Team ID from Apple Developer Account
  },
  production: false, // Set to `true` if using in production
});

// Function to send a push notification
async function sendPushNotification(deviceToken, payload) {
  const notification = new apn.Notification();

  // Set notification payload
  notification.alert = payload.alert; // Message to display
  notification.badge = payload.badge || 1; // Badge count
  notification.sound = payload.sound || "default"; // Notification sound
  notification.topic = "com.yourcompany.yourapp"; // App bundle ID

  try {
    const result = await apnProvider.send(notification, deviceToken);
    console.log("Sent:", result.sent.length, "Failed:", result.failed.length);
    console.log("Failed reasons:", result.failed);
  } catch (error) {
    console.error("Error sending notification:", error);
  }
}

// curl -X POST http://localhost:3000/generateCustomToken \
// -H "Content-Type: application/json" \
// -d '{"idToken": "YOUR_FIREBASE_ID_TOKEN"}'

// Initialize Firebase Admin SDK
// admin.initializeApp({
//   credential: admin.credential.cert(require("./serviceAccountKey.json")),
// });

admin.initializeApp({
  credential: admin.credential.cert(
    require("./petlife-15761-firebase-adminsdk-he02j-c2c6e9d51b.json")
  ),
  databaseURL: "https://petlife-15761-default-rtdb.firebaseio.com",
});

const db = admin.database(); // Firebase Realtime Database reference

// Middleware to parse JSON bodies
app.use(bodyParser.json());

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
    await initializeUser(uid);
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
  cron.schedule("*/30 * * * * *", () => {
    console.log("Running decreaseValuesByX service...");
    decreaseValuesByX(5); // Adjust the value of X as needed
  });

  // **Service 2**: Check for values below Y every 5 minutes
  cron.schedule("*/10 * * * * *", () => {
    console.log("Running checkValuesBelowY service...");
    checkValuesBelowY(20); // Adjust the threshold Y as needed
  });

  // Schedule the incrementAge service to run every 20 minutes
  cron.schedule("*/10 * * * * *", () => {
    console.log("Running incrementAge service...");
    incrementAgeForAllPets();
  });
});

// Route to trigger services manually (useful for debugging)
app.get("/run-services", (req, res) => {
  const x = 10; // Decrease by 10
  const y = 20; // Threshold for alerts

  console.log("Running decreaseValuesByX service...");
  decreaseValuesByX(x);

  console.log("Running checkValuesBelowY service...");
  checkValuesBelowY(y);

  res.send("Services executed.");
});

// **Service 1**: Decrease all numbers by X periodically
function decreaseValuesByX(x) {
  const rootRef = db.ref(); // Get the root reference

  rootRef.once("value", (snapshot) => {
    const data = snapshot.val();

    if (!data) {
      console.log("No data found in the database.");
      return;
    }

    // Iterate through all categories (e.g., FOOD, PLAY, SLEEP, WATER)
    for (const category in data) {
      if (category === "AGE") {
        console.log("Cant dec, Category is: ", category);
        continue;
      }
      const users = data[category];
      for (const userId in users) {
        const pets = users[userId]["PETS"];
        for (const petId in pets) {
          const currentValue = pets[petId];

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
function checkValuesBelowY(y) {
  const rootRef = db.ref(); // Get the root reference

  rootRef.once("value", (snapshot) => {
    const data = snapshot.val();

    if (!data) {
      console.log("No data found in the database.");
      return;
    }

    // Iterate through all categories (e.g., FOOD, PLAY, SLEEP, WATER)
    for (const category in data) {
      const users = data[category];
      for (const userId in users) {
        const pets = users[userId]["PETS"];
        for (const petId in pets) {
          const currentValue = pets[petId];

          if (typeof currentValue === "number" && currentValue < y) {
            // console.log(
            //   `Alert: ${category}/${userId}/PETS/${petId} has value ${currentValue} (below threshold ${y})`
            // );
            // Placeholder: Replace this with Apple Push Notification logic
            // sendPushNotification(userId, category, petId, currentValue);
            const deviceToken = "DEVICE_TOKEN_FROM_CLIENT";
            const payload = {
              alert: "Check your pet!",
              badge: 1,
              sound: "default",
            };
            // sendPushNotification();
          }
        }
      }
    }
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
          // console.log(`Updated AGE at ${petPath}: ${currentAge} -> ${newAge}`);
        } else {
          // console.log(
          //   `No valid number found at path: ${rootPath}/${userId}/PETS/${petId}`
          // );
        }
      }
    }
  });
}

// Function to initialize user fields (AGE, FOOD, SLEEP, PLAY, WATER)
async function initializeUser(uid) {
  try {
    const paths = ["AGE", "FOOD", "SLEEP", "PLAY", "WATER", "NAME"];
    const petId = "PET0"; // Default first pet ID
    const initialValues = 0; // Default starting value

    // Iterate over each path and check/create data for the user
    for (const path of paths) {
      const userPath = `${path}/${uid}/PETS/${petId}`;
      const ref = db.ref(userPath);

      // Check if the field already exists
      const snapshot = await ref.once("value");

      if (!snapshot.exists()) {
        // Create the field if it doesn't exist

        if (path === "NAME") {
          await ref.set("EggName");
        } else {
          await ref.set(initialValues);
        }

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
