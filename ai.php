<?php
include "config.php";

$data = json_decode(file_get_contents("php://input"), true);
$message = $data['message'];

/* SIMPLE AI LOGIC (you can replace with OpenAI API) */

$reply = "I understand you said: " . $message . ". Tell me more ❤️";

echo json_encode([
    "reply" => $reply
]);
?>
