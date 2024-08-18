import dotenv from "dotenv";
import express from "express";
import "./bot.js"

dotenv.config();

const app = express();

app.get("/", (req, res) => {
    res.send("Hi");
})

app.listen(process.env.PORT, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
});


