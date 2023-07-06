const express = require("express");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");
const http = require("http");
const { log } = require("console");
const multer = require("multer");
const cors = require("cors");
const Pusher = require("pusher");

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
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        matches: true,
        likesReceived: true,
      },
    });

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

// get all profiles - integrated
app.get("/profiles/:id", async (req, res) => {
  // log("serving profiles");
  const { id } = req.params;
  try {
    const users = await prisma.user.findMany({
      where: {
        NOT: {
          id: id, // Exclude the profile of the logged-in user
        },
      },
    });

    if (!users) {
      res.status(404).json({ error: "Users not found" });
      return;
    }

    res.json({ success: true, users });
  } catch (error) {
    console.error(error);
    res.json({ error: "Internal server error" });
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

// Like user -- done
app.post("/users/:id/like", async (req, res) => {
  const { id } = req.params;
  const { senderId } = req.body;

  try {
    const sender = await prisma.user.findUnique({
      where: { id: senderId },
      include: { likesReceived: true },
    });

    const receiver = await prisma.user.findUnique({
      where: { id },
      include: { likesReceived: true },
    });

    if (!sender || !receiver) {
      res.json({ error: "Invalid user IDs" });
      return;
    }

    log(sender);

    // Check if receiver exists in the sender's likes array
    const receiverLiked = sender.likesReceived.some(
      (like) => like.senderId === receiver.id
    );

    log(receiverLiked);
    // Create a new like
    const like = await prisma.like.create({
      data: {
        sender: { connect: { id: sender.id } },
        receiver: { connect: { id: receiver.id } },
        isMatch: false,
      },
    });

    // Emit the "likeReceived" event to the receiver's socket
    const pusher = new Pusher({
      appId: "1623541",
      key: "a728b9c53d826193a26d",
      secret: "15f12a0efe554a7afa6e",
      cluster: "eu",
      useTLS: true,
    });

    if (receiverLiked) {
      // Create a new conversation if receiver likes the sender as well
      log("convo path");
      const conversation = await prisma.conversation.create({
        data: {
          participants: {
            connect: [{ id: sender.id }, { id: receiver.id }],
          },
        },
      });

      // Update the sender's conversationId
      await prisma.user.update({
        where: { id: sender.id },
        data: {
          conversationId: conversation.id,
        },
      });

      // Update the receiver's conversationId
      await prisma.user.update({
        where: { id: receiver.id },
        data: {
          conversationId: conversation.id,
        },
      });

      // Emit the "conversationCreated" event to both users' sockets

      pusher.trigger("my-channel", sender.id, {
        event: "conversationCreated",
        conversationId: conversation.id,
      });

      pusher.trigger("my-channel", receiver.id, {
        event: "conversationCreated",
        conversationId: conversation.id,
      });
    } else {
      log("normal path");
      pusher.trigger("my-channel", receiver.id, {
        message: "hello world",
      });
    }
    res.json({ success: true, like });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// get all conversations between matched users --done
app.get("/users/:userId/conversations", async (req, res) => {
  const { userId } = req.params;

  try {
    const conversations = await prisma.conversation.findMany({
      where: {
        participants: {
          some: {
            id: userId,
          },
        },
      },
      include: {
        participants: true,
        messages: true,
      },
    });

    // Filter and map the response
    const filteredResponse = conversations.map((convo) => {
      // Filter the participants array to exclude the current user
      const otherParticipant = convo.participants.filter(
        (participant) => participant.id !== userId
      );

      // Extract the messages array
      const messages = convo.messages;

      // Return the filtered conversation object with the other participant and messages
      return {
        ...convo,
        participants: otherParticipant,
        messages: messages,
      };
    });

    res.json({ success: true, convo: filteredResponse });
  } catch (error) {
    console.error("Error retrieving conversations:", error);
    res
      .status(500)
      .json({ error: "An error occurred while retrieving conversations" });
  }
});

//get one convo -- done
app.get("/conversations/:conversationId", async (req, res) => {
  const { conversationId } = req.params;

  try {
    const conversation = await prisma.conversation.findUnique({
      where: {
        id: conversationId,
      },
      include: {
        participants: true,
        messages: true,
      },
    });

    if (!conversation) {
      return res.json({ error: "Conversation not found" });
    }

    res.json({ success: true, convo: conversation });
  } catch (error) {
    console.error("Error retrieving conversation:", error);
    res
      .status(500)
      .json({ error: "An error occurred while retrieving conversation" });
  }
});

// send message -- done
app.post("/conversations/:conversationId/messages", async (req, res) => {
  const conversationId = req.params.conversationId;
  const { senderId, content, receiverId } = req.body;
  log(content);
  try {
    const conversation = await prisma.conversation.findUnique({
      where: {
        id: conversationId,
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const message = await prisma.message.create({
      data: {
        content,
        sender: { connect: { id: senderId } },
        conversation: { connect: { id: conversationId } },
        receiver: {
          connect: {
            id: receiverId,
          },
        },
      },
    });

    res.json(message);
  } catch (error) {
    console.error("Error sending message:", error);
    res
      .status(500)
      .json({ error: "An error occurred while sending the message" });
  }
});

// Get matches for user
// app.get("/users/:id/matches", async (req, res) => {
//   const { id } = req.params;

//   try {
//     const user = await prisma.user.findUnique({
//       where: { id },
//       include: { matches: { include: { user: true } } },
//     });

//     if (!user) {
//       res.status(404).json({ error: "User not found" });
//       return;
//     }

//     const matches = user.matches;
//     res.json(matches);
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ error: "Internal server error" });
//   }
// });

// app.get("/likes/:id", async (req, res) => {
//   const { receiverId } = req.params;

//   try {
//     let recievedlikes;

//     // Fetch likes with the specified receiverId from the database
//     recievedlikes = await prisma.like.findMany({
//       where: {
//         receiverId: receiverId,
//       },
//     });

//     // Return the likes as the response

//     res.json(recievedlikes);
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ error: "An error occurred while fetching likes." });
//   }
// });

app.listen(port, () => {
  log(`Server is running on port ${port}`);
});
