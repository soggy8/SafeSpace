const menuBtn = document.getElementById("menu_btn");
const sideMenu = document.getElementById("side_menu");
const content = document.getElementById("content");

menuBtn.addEventListener("click",() => {
    sideMenu.classList.toggle("hidden")
    content.classList.toggle("shifted")
});