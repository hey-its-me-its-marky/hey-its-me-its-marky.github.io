document.addEventListener("click", (event) => {

    const openButton = event.target.closest("[data-popup-open]");

    if (openButton) {
        event.preventDefault();

        const name = openButton.dataset.popupOpen;
        const popup = document.querySelector(
            `[data-popup="${name}"]`
        );

        if (!popup) return;

        popup.classList.add("open");
    }

    const closeButton = event.target.closest("[data-popup-close]");

    if (closeButton) {
        event.preventDefault();

        const popup = closeButton.closest("[data-popup]");

        if (!popup) return;

        popup.classList.remove("open");
    }

});
