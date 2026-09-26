const clusters = document.querySelectorAll(".cluster");

function updateCorners(cluster) {
    const buttons = [...cluster.querySelectorAll(".btn")];

    buttons.forEach(btn => {
        btn.classList.remove(
            "corner-tl",
            "corner-tr",
            "corner-bl",
            "corner-br"
        );
    });

    if (!buttons.length) return;

    const rows = [];

    for (const btn of buttons) {
        const rect = btn.getBoundingClientRect();

        let row = rows.find(
            row => Math.abs(row.top - rect.top) < 2
        );

        if (!row) {
            row = {
                top: rect.top,
                buttons: []
            };

            rows.push(row);
        }

        row.buttons.push(btn);
    }

    rows.sort((a, b) => a.top - b.top);

    rows.forEach(row => {
        row.buttons.sort(
            (a, b) =>
                a.getBoundingClientRect().left -
                b.getBoundingClientRect().left
        );
    });

    const firstRow = rows[0];
    const lastRow = rows.at(-1);

    if (rows.length === 1) {
        firstRow.buttons[0].classList.add("corner-tl", "corner-bl");
        firstRow.buttons.at(-1).classList.add("corner-tr", "corner-br");
        return;
    }

    firstRow.buttons[0].classList.add("corner-tl");
    firstRow.buttons.at(-1).classList.add("corner-tr");

    lastRow.buttons[0].classList.add("corner-bl");
    lastRow.buttons.at(-1).classList.add("corner-br");
}

function updateAllCorners() {
    clusters.forEach(cluster => updateCorners(cluster));
}

updateAllCorners();
window.addEventListener("resize", updateAllCorners);

