const express = require("express");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");
const fs = require("fs");
const path = require("path");
const { log } = require("console");
const { promisify } = require("util");
const multer = require("multer");
const cors = require("cors");
const writeFileAsync = promisify(fs.writeFile);
const app = express();
const prisma = new PrismaClient();

app.use(cors({ origin: "*" }));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/uploads", express.static("uploads"));
const port = process.env.PORT || 4000;
const upload = multer({ dest: "uploads/" });

// endpoints
app.get("/", (req, res) => {
  res.send("server is working");
});

// Login - integrated
app.post("/login", upload.single("profileImage"), async (req, res) => {
  const { email, password } = req.body;
  log("login data ", req.body);
  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      res.json({ error: "User not found" });
      return;
    }

    // Perform password validation here (e.g., using bcrypt)
    // Replace the placeholder with your actual password validation logic
    const isPasswordValid = bcrypt.compare(password, user.password);

    // log("password: ", hashedPassword, "\n is valid: ", user.password);
    if (!isPasswordValid) {
      res.json({ error: "Invalid password" });
      return;
    }

    res.json({ success: true, user });
  } catch (error) {
    console.error(error);
    res.json({ error: "Internal server error" });
  }
});

// create new user - integrated
app.post("/users/create", upload.single("profileImage"), async (req, res) => {
  log("data incoming", req.body, req.file);
  const { name, email, password, bio, dob, gender, location } = req.body;
  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      res.json({ error: "User already exists" });
      return;
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create a new user
    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        bio,
        dob: new Date(dob),
        gender,
        location,
        profileImageUrl: req.file.path,
      },
    });

    res.json({ success: true, user: newUser });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: `Internal server error \n ${error}` });
  }
});

// Get user profile
app.get("/users/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const user = await prisma.user.findUnique({ where: { id } });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update user profile
app.put("/users/:id", async (req, res) => {
  const { id } = req.params;
  const { name, bio, profileImageUrl, preferences } = req.body;

  try {
    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        name,
        bio,
        profileImageUrl,
        preferences,
      },
    });

    res.json(updatedUser);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Like user
app.post("/users/:id/like", async (req, res) => {
  const { id } = req.params;
  const { senderId } = req.body;

  try {
    const sender = await prisma.user.findUnique({ where: { id: senderId } });
    const receiver = await prisma.user.findUnique({ where: { id } });

    if (!sender || !receiver) {
      res.status(400).json({ error: "Invalid user IDs" });
      return;
    }

    // Create a new like
    const like = await prisma.like.create({
      data: {
        sender: { connect: { id: sender.id } },
        receiver: { connect: { id: receiver.id } },
        isMatch: false,
      },
    });

    res.json(like);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get matches for user
app.get("/users/:id/matches", async (req, res) => {
  const { id } = req.params;

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      include: { matches: { include: { user: true } } },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const matches = user.matches.filter((match) => match.isMatch);
    res.json(matches);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create conversation between matched users
app.post("/conversations", async (req, res) => {
  const { user1Id, user2Id } = req.body;

  try {
    const user1 = await prisma.user.findUnique({
      where: { id: user1Id },
      include: { matches: true },
    });
    const user2 = await prisma.user.findUnique({
      where: { id: user2Id },
      include: { matches: true },
    });

    if (!user1 || !user2) {
      res.status(400).json({ error: "Invalid user IDs" });
      return;
    }

    const user1Matches = user1.matches.map((match) => match.userid);
    const user2Matches = user2.matches.map((match) => match.userid);

    // Check if users are matched
    if (!user1Matches.includes(user2.id) || !user2Matches.includes(user1.id)) {
      res.status(400).json({ error: "Users are not matched" });
      return;
    }

    // Create a new conversation
    const conversation = await prisma.conversation.create({
      data: {
        participants: {
          connect: [{ id: user1.id }, { id: user2.id }],
        },
      },
    });

    res.json(conversation);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(port, () => {
  log(`Server is running on port ${port}`);
});
