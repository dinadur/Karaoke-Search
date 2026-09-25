// Decorative "stage night" effects. Every effect responds to something the
// person did (or to loading), is skipped when they prefer reduced motion, and
// never carries state: the app calls these after it has already updated the
// DOM and data, so a missing or failing effect cannot change behavior.
// Temporary elements are aria-hidden, ignore pointer events, and remove
// themselves; nothing here moves focus or writes to live regions.

window.StageFx = (() => {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia?.("(hover: hover) and (pointer: fine)");
    const classTimers = new WeakMap();
    let singTimer = 0;

    function motionOK() {
        return !reducedMotion?.matches && !document.hidden &&
            typeof Element.prototype.animate === "function";
    }

    function safely(effect) {
        return (...args) => {
            try {
                return effect(...args);
            } catch (error) {
                console.warn("Stage effect skipped", error);
                return undefined;
            }
        };
    }

    function color(name, fallback) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    }

    function palette() {
        return [color("--brand", "#6247c9"), color("--accent", "#c74735"), color("--gold", "#b77d19"), "#f3b8ff"];
    }

    function isOnScreen(element) {
        if (!element?.isConnected) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
            rect.top < window.innerHeight && rect.left < window.innerWidth;
    }

    // A modal <dialog> sits in the top layer, above anything added to <body>.
    function createLayer(anchor) {
        const layer = document.createElement("div");
        layer.className = "fx-layer";
        layer.setAttribute("aria-hidden", "true");
        (anchor?.closest?.("dialog[open]") || document.body).appendChild(layer);
        return layer;
    }

    function removeWhenDone(layer, animations, timeout) {
        const remove = () => layer.remove();
        Promise.all(animations.map((animation) => animation.finished)).then(remove, remove);
        // Paused (background) documents may never finish; don't leak nodes.
        window.setTimeout(remove, timeout);
    }

    // Restartable one-shot CSS animation driven by a class. A timer (not
    // animationend, which bubbles from descendants) removes the class.
    function playClass(element, className, duration) {
        if (!element) return;
        const timers = classTimers.get(element) || {};
        window.clearTimeout(timers[className]);
        element.classList.remove(className);
        void element.offsetWidth;
        element.classList.add(className);
        timers[className] = window.setTimeout(() => element.classList.remove(className), duration);
        classTimers.set(element, timers);
    }

    function centerOf(rect, base) {
        return { x: rect.left + rect.width / 2 - base.left, y: rect.top + rect.height / 2 - base.top };
    }

    function sparkle(anchor, { count = 10, distance = 30, duration = 720 } = {}) {
        if (!motionOK() || !isOnScreen(anchor)) return;
        const layer = createLayer(anchor);
        const origin = centerOf((anchor.querySelector("svg") || anchor).getBoundingClientRect(), layer.getBoundingClientRect());
        const colors = [color("--gold", "#b77d19"), ...palette()];
        const animations = [];
        for (let index = 0; index < count; index++) {
            const piece = document.createElement("span");
            piece.className = index % 2 ? "fx-spark" : "fx-spark is-star";
            piece.style.left = `${origin.x}px`;
            piece.style.top = `${origin.y}px`;
            piece.style.background = colors[index % colors.length];
            layer.appendChild(piece);
            const angle = (index / count) * Math.PI * 2 + Math.random() * 0.5;
            const reach = distance * (0.75 + Math.random() * 0.5);
            const x = Math.cos(angle) * reach;
            const y = Math.sin(angle) * reach;
            animations.push(piece.animate([
                { transform: "translate(0, 0) scale(0.3) rotate(0deg)", opacity: 1 },
                { transform: `translate(${x}px, ${y}px) scale(1) rotate(90deg)`, opacity: 1, offset: 0.6 },
                { transform: `translate(${x * 1.25}px, ${y * 1.25 + 6}px) scale(0) rotate(160deg)`, opacity: 0 },
            ], { duration, easing: "cubic-bezier(.2, .75, .3, 1)", fill: "forwards" }));
        }
        removeWhenDone(layer, animations, duration + 600);
    }

    // Saving a song: the star pops and throws a few sparks.
    function saved(button) {
        if (!motionOK() || !button?.isConnected) return;
        playClass(button, "fx-pop", 600);
        sparkle(button);
    }

    // Adding a song: its cover tile (or a note) arcs into the setlist rail, or
    // into the floating Setlist button on phones, and the target reacts.
    function added(source) {
        if (!motionOK() || !source?.isConnected || source.closest("dialog")) return;
        const item = document.querySelector("#setlist > .setlist-item:last-child");
        const mobileButton = document.getElementById("mobileSetlistButton");
        const target = isOnScreen(item) ? item : isOnScreen(mobileButton) ? mobileButton : null;
        const tile = source.closest(".song-card, .browse-row, .artist-song-row")?.querySelector(".cover-tile");
        const start = isOnScreen(tile) ? tile : source;
        if (!target || !isOnScreen(start)) return;

        const layer = createLayer();
        const base = layer.getBoundingClientRect();
        const from = start.getBoundingClientRect();
        const to = target.getBoundingClientRect();
        const size = start === tile ? Math.min(from.width, 46) : 30;
        const origin = centerOf(from, base);
        const landing = target === item
            ? { x: to.left + 26 - base.left, y: to.top + Math.min(to.height / 2, 22) - base.top }
            : centerOf(to, base);
        const dx = landing.x - origin.x;
        const dy = landing.y - origin.y;

        const flight = document.createElement("div");
        flight.className = "fx-flight";
        flight.style.left = `${origin.x - size / 2}px`;
        flight.style.top = `${origin.y - size / 2}px`;
        const flyer = start === tile ? tile.cloneNode(true) : document.createElement("span");
        flyer.classList.add("fx-flyer");
        if (start !== tile) flyer.textContent = "♪";
        flyer.style.width = `${size}px`;
        flyer.style.height = `${size}px`;
        flight.appendChild(flyer);
        layer.appendChild(flight);

        const duration = 640;
        const horizontal = flight.animate(
            [{ transform: "translateX(0)" }, { transform: `translateX(${dx}px)` }],
            { duration, easing: "cubic-bezier(.3, 0, .75, 1)", fill: "forwards" }
        );
        // Hop up before dropping into a lower target; glide into a higher one.
        const vertical = flyer.animate([
            { transform: "translateY(0) scale(1) rotate(0deg)", opacity: 1 },
            { transform: `translateY(${dy}px) scale(0.42) rotate(${dx < 0 ? -14 : 14}deg)`, opacity: 0.9 },
        ], {
            duration,
            easing: dy > 0 ? "cubic-bezier(.35, -0.7, .75, 1)" : "cubic-bezier(.2, .7, .35, 1)",
            fill: "forwards",
        });
        if (target === item) {
            item.animate([{ opacity: 0 }, { opacity: 0, offset: 0.85 }, { opacity: 1 }], { duration: duration + 80 });
        }
        vertical.finished.then(() => playClass(target, target === item ? "fx-landed" : "fx-bump", 1050), () => {});
        removeWhenDone(layer, [horizontal, vertical], duration + 600);
    }

    // Random pick: the cover tile spins like a slot reel through a few other
    // songs before landing on the pick. The real card is complete underneath.
    function spin(card, decoys = []) {
        if (!motionOK() || !card?.isConnected) return;
        roll(card.closest(".random-pick")?.querySelector(".random-pick-label"));
        const tile = card.querySelector(".cover-tile");
        if (!tile || !decoys.length || typeof createCoverTile !== "function") return;

        const height = tile.offsetHeight || 46;
        const reel = document.createElement("span");
        reel.className = "fx-reel";
        reel.style.setProperty("--reel-size", `${height}px`);
        for (const song of decoys) reel.appendChild(createCoverTile(song));
        reel.appendChild(tile.cloneNode(true));
        tile.classList.add("fx-spinning");
        tile.appendChild(reel);

        const duration = 950;
        const travel = (reel.children.length - 1) * height;
        const animation = reel.animate(
            [{ transform: "translateY(0)" }, { transform: `translateY(${-travel}px)` }],
            { duration, easing: "cubic-bezier(.12, .62, .18, 1)", fill: "forwards" }
        );
        card.querySelector(".card-head-text")?.animate([
            { opacity: 0, transform: "translateY(6px)", filter: "blur(3px)" },
            { opacity: 1, transform: "none", filter: "blur(0)" },
        ], { duration: 360, delay: duration - 360, easing: "ease-out", fill: "backwards" });

        const finish = () => {
            reel.remove();
            tile.classList.remove("fx-spinning");
        };
        animation.finished.then(() => {
            finish();
            playClass(card, "fx-landed-card", 850);
        }, finish);
        window.setTimeout(finish, duration + 600);
    }

    // Draft: a short confetti burst from the button that filled the setlist.
    function confetti(originRect, { count = 36 } = {}) {
        if (!motionOK() || !originRect?.width) return;
        const layer = createLayer();
        const origin = centerOf(originRect, layer.getBoundingClientRect());
        const colors = palette();
        const gravity = 1100;
        // Near the top of the screen, throw lower so pieces peak in view.
        const maxRise = Math.sqrt(2 * gravity * Math.max(60, origin.y - 12));
        const animations = [];
        for (let index = 0; index < count; index++) {
            const piece = document.createElement("span");
            piece.className = index % 4 === 0 ? "fx-confetti is-round" : "fx-confetti";
            piece.style.left = `${origin.x}px`;
            piece.style.top = `${origin.y}px`;
            piece.style.background = colors[index % colors.length];
            layer.appendChild(piece);

            const angle = (-90 + (Math.random() - 0.5) * 120) * Math.PI / 180;
            const speed = 300 + Math.random() * 280;
            const vx = Math.cos(angle) * speed;
            const vy = Math.max(Math.sin(angle) * speed, -maxRise * (0.75 + Math.random() * 0.25));
            const turn = (Math.random() - 0.5) * 1080;
            const duration = 1050 + Math.random() * 450;
            const frames = [];
            for (let step = 0; step <= 8; step++) {
                const t = (step / 8) * (duration / 1000);
                frames.push({
                    transform: `translate(${vx * t}px, ${vy * t + gravity * t * t / 2}px) rotate(${turn * t}deg) rotateY(${step * 70}deg)`,
                    opacity: step < 5 ? 1 : 1 - (step - 4) / 4,
                });
            }
            animations.push(piece.animate(frames, {
                duration, delay: Math.random() * 80, easing: "linear", fill: "both",
            }));
        }
        removeWhenDone(layer, animations, 2200);
    }

    function roll(element) {
        if (motionOK()) playClass(element, "fx-roll", 850);
    }

    function cascade(items) {
        if (!motionOK()) return;
        [...items].forEach((item, index) => item.animate([
            { opacity: 0, transform: "translateY(10px)" },
            { opacity: 1, transform: "none" },
        ], { duration: 320, delay: 90 + index * 55, easing: "cubic-bezier(.2, .8, .3, 1)", fill: "backwards" }));
    }

    // Theme: the new lighting spreads from where the switch was used. Browsers
    // route clicks to the page itself while a view transition runs, so it
    // stays short.
    function switchTheme(apply, point) {
        if (!motionOK() || typeof document.startViewTransition !== "function") {
            apply();
            return;
        }

        const x = point?.x ?? window.innerWidth / 2;
        const y = point?.y ?? 0;
        let transition;
        try {
            transition = document.startViewTransition(apply);
        } catch {
            apply();
            return;
        }
        transition.ready.then(() => {
            const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
            document.documentElement.animate(
                { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
                { duration: 480, easing: "cubic-bezier(.4, 0, .2, 1)", pseudoElement: "::view-transition-new(root)" }
            );
        }).catch(() => {});
    }

    // New search results: highlighted matches fill in like karaoke lyrics.
    function sing(list) {
        if (!motionOK() || !list) return;
        [...list.querySelectorAll(".song-card")].slice(0, 24)
            .forEach((card, index) => card.style.setProperty("--sing-delay", `${index * 40}ms`));
        window.clearTimeout(singTimer);
        list.classList.remove("fx-sing");
        void list.offsetWidth;
        list.classList.add("fx-sing");
        singTimer = window.setTimeout(() => list.classList.remove("fx-sing"), 1800);
    }

    // Cards catch a soft spotlight that follows a mouse pointer.
    function bindSpotlight() {
        let card = null;
        let x = 0;
        let y = 0;
        let frame = 0;
        document.addEventListener("pointermove", (event) => {
            if (event.pointerType !== "mouse" || !finePointer?.matches || reducedMotion?.matches) return;
            const next = event.target.closest?.(".song-card");
            if (!next) return;
            card = next;
            x = event.clientX;
            y = event.clientY;
            frame ||= window.requestAnimationFrame(() => {
                frame = 0;
                const rect = card.getBoundingClientRect();
                card.style.setProperty("--spot-x", `${Math.round(x - rect.left)}px`);
                card.style.setProperty("--spot-y", `${Math.round(y - rect.top)}px`);
            });
        }, { passive: true });
    }

    safely(bindSpotlight)();

    return {
        saved: safely(saved),
        added: safely(added),
        spin: safely(spin),
        confetti: safely(confetti),
        cascade: safely(cascade),
        roll: safely(roll),
        switchTheme: (apply, point) => {
            try {
                switchTheme(apply, point);
            } catch {
                apply();
            }
        },
        sing: safely(sing),
    };
})();
