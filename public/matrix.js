const canvas = document.getElementById("matrix-canvas");
const ctx = canvas.getContext("2d");
const letters = "アァイィウヴエェオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
const fontSize = 16;
const frameInterval = 65;
let drops = [];
let lastFrameTime = 0;
let animationFrame = null;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function resizeCanvas() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const columns = Math.ceil(width / fontSize);
    drops = new Array(columns).fill(1);
}

function drawMatrix() {
    ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.fillStyle = "#39FF14";
    ctx.font = fontSize + "px monospace";

    for (let i = 0; i < drops.length; i++) {
        const text = letters[Math.floor(Math.random() * letters.length)];
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);
        if (drops[i] * fontSize > window.innerHeight || Math.random() > 0.975) {
            drops[i] = 0;
        }
        drops[i]++;
    }
}

function animate(timestamp) {
    if (timestamp - lastFrameTime >= frameInterval) {
        drawMatrix();
        lastFrameTime = timestamp;
    }
    animationFrame = requestAnimationFrame(animate);
}

function updateAnimation() {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
    if (!document.hidden && !reducedMotion.matches) animationFrame = requestAnimationFrame(animate);
    else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
}
resizeCanvas();
updateAnimation();
document.addEventListener("visibilitychange", updateAnimation);
reducedMotion.addEventListener("change", updateAnimation);
window.addEventListener("resize", resizeCanvas);
