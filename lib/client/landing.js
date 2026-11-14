/**
 * Contact delivery.
 * email:    public contact address used by "Email us" links. Replace the
 *           placeholder with the real company address before launch, or set
 *           to null to hide those links.
 * endpoint: POST JSON { name, organization, email, topic, message }.
 *           Saved to the contact_inquiries table by the API.
 */
export const CONTACT = {
  email: "contact@fauchar.example",
  endpoint: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/api/contact`,
  method: "POST",
};

export function initLanding() {
  if (typeof document === "undefined") return;
  if (document.documentElement.dataset.faucharLanding === "1") return;
  document.documentElement.dataset.faucharLanding = "1";
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const motionOK = () => !reduceMotion.matches;
  const mobileNav = window.matchMedia("(max-width: 860px)");

  const run = (fn) => {
    try {
      fn();
    } catch (error) {
      console.error(error);
    }
  };

  run(initHeader);
  run(initNav);
  run(initReveal);
  run(initProgress);
  run(initParallax);
  run(initMailto);
  run(initContact);
  run(initYear);

  function initHeader() {
    const header = document.getElementById("header");
    if (!header) return;

    const cells = [...header.querySelectorAll(".mark rect")];
    cells.forEach((cell, index) => {
      const order = (Number(cell.getAttribute("y")) - 5) / 7 + (index % 8) * 0.35;
      cell.style.setProperty("--v", order.toFixed(2));
    });

    if (document.body.classList.contains("page-plain")) return;

    const inner = header.querySelector(".header-inner");
    const bar = document.createElement("span");
    bar.className = "header-progress";
    bar.setAttribute("aria-hidden", "true");
    if (inner) inner.appendChild(bar);

    let ticking = false;
    const sync = () => {
      ticking = false;
      header.classList.toggle("is-scrolled", window.scrollY > 8);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
      header.style.setProperty("--header-progress", progress.toFixed(4));
    };

    sync();
    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(sync);
      },
      { passive: true }
    );
    window.addEventListener("resize", sync);
  }

  function initNav() {
    const toggle = document.querySelector(".nav-toggle");
    const nav = document.getElementById("site-nav");
    if (!toggle || !nav) return;

    const label = toggle.querySelector("[data-toggle-label]");
    const links = [...nav.querySelectorAll("a")];

    const list = nav.querySelector("ul");
    const glide = document.createElement("span");
    glide.className = "nav-glide";
    glide.setAttribute("aria-hidden", "true");
    if (list) {
      list.prepend(glide);
      [...list.querySelectorAll("li")].forEach((item, index) => item.style.setProperty("--n", index));
    }

    const moveGlide = (link) => {
      if (!list || mobileNav.matches || !link) {
        glide.classList.remove("is-on");
        return;
      }
      const box = link.getBoundingClientRect();
      const base = list.getBoundingClientRect();
      glide.style.setProperty("--glide-x", `${(box.left - base.left).toFixed(1)}px`);
      glide.style.setProperty("--glide-w", `${box.width.toFixed(1)}px`);
      glide.classList.add("is-on");
    };

    const restGlide = () => moveGlide(list ? list.querySelector("a[aria-current='true']") : null);

    if (list) {
      list.querySelectorAll("a").forEach((link) => {
        link.addEventListener("pointerenter", () => moveGlide(link));
        link.addEventListener("focus", () => moveGlide(link));
      });
      list.addEventListener("pointerleave", restGlide);
      list.addEventListener("focusout", (event) => {
        if (!list.contains(event.relatedTarget)) restGlide();
      });
      window.addEventListener("resize", restGlide);
      if (document.fonts) document.fonts.ready.then(restGlide);
    }

    const isOpen = () => toggle.getAttribute("aria-expanded") === "true";

    const syncInert = () => {
      if (mobileNav.matches && !isOpen()) nav.setAttribute("inert", "");
      else nav.removeAttribute("inert");
    };

    const close = (focusToggle = false) => {
      toggle.setAttribute("aria-expanded", "false");
      nav.classList.remove("is-open");
      document.body.classList.remove("nav-open");
      if (label) label.textContent = "Open menu";
      syncInert();
      if (focusToggle) toggle.focus();
    };

    const open = () => {
      toggle.setAttribute("aria-expanded", "true");
      nav.classList.add("is-open");
      document.body.classList.add("nav-open");
      if (label) label.textContent = "Close menu";
      syncInert();
      const first = links[0];
      if (first) first.focus();
    };

    toggle.addEventListener("click", () => {
      if (isOpen()) close(false);
      else open();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isOpen()) close(true);
    });

    nav.addEventListener("keydown", (event) => {
      if (!isOpen() || event.key !== "Tab") return;
      const items = links.filter((link) => !link.closest("[hidden]"));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    document.addEventListener("click", (event) => {
      const link = event.target.closest("a[href]");
      if (!link) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;

      const href = link.getAttribute("href");
      if (!href || !href.startsWith("#") || href === "#") return;
      const target = document.querySelector(href);
      if (!target) return;

      event.preventDefault();
      if (isOpen()) close(false);

      const behavior = motionOK() ? "smooth" : "auto";
      const focusId = link.dataset.focus;
      const field = focusId ? document.getElementById(focusId) : null;

      const topic = link.dataset.topic;
      const topicSelect = document.getElementById("contact-topic");
      if (topic && topicSelect) topicSelect.value = topic;

      if (field) {
        field.focus({ preventScroll: true });
        field.scrollIntoView({ behavior, block: "center" });
      } else {
        target.scrollIntoView({ behavior, block: "start" });
        if (target.hasAttribute("tabindex")) target.focus({ preventScroll: true });
      }

      if (history.pushState && !href.startsWith("#contact-")) history.pushState(null, "", href);
    });

    const spyLinks = [...document.querySelectorAll(".site-nav a[href^='#']")];
    const sections = spyLinks
      .map((link) => document.querySelector(link.getAttribute("href")))
      .filter(Boolean);

    if (sections.length && "IntersectionObserver" in window) {
      const spy = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const link = document.querySelector(`.site-nav a[href="#${entry.target.id}"]`);
            if (!link) return;
            spyLinks.forEach((item) => item.removeAttribute("aria-current"));
            link.setAttribute("aria-current", "true");
            if (!list || !list.matches(":hover")) restGlide();
          });
        },
        { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
      );
      sections.forEach((section) => spy.observe(section));
    }

    mobileNav.addEventListener("change", () => {
      if (!mobileNav.matches) close(false);
      syncInert();
    });

    syncInert();
  }

  function initReveal() {
    const items = [...document.querySelectorAll(".reveal")];
    if (!items.length) return;

    if (!("IntersectionObserver" in window) || !motionOK()) {
      items.forEach((item) => item.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
    );

    items.forEach((item) => observer.observe(item));
  }

  /* Scroll-linked progress for the workflow and roadmap lines. */
  function initProgress() {
    const blocks = [...document.querySelectorAll("[data-progress]")];
    if (!blocks.length) return;

    const steps = blocks.map((block) => [...block.querySelectorAll(".pstep, .phase")]);
    let ticking = false;

    const update = () => {
      ticking = false;
      const vh = window.innerHeight;
      blocks.forEach((block, index) => {
        const rect = block.getBoundingClientRect();
        let progress = motionOK() ? (vh * 0.75 - rect.top) / (rect.height + vh * 0.2) : 1;
        progress = clamp(progress, 0, 1);
        block.style.setProperty("--progress", progress.toFixed(3));
        const list = steps[index];
        list.forEach((step, stepIndex) => {
          const threshold = list.length > 1 ? stepIndex / (list.length - 1) : 0;
          step.classList.toggle("is-active", progress >= threshold * 0.98 && progress > 0);
        });
      });
    };

    const request = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request);
  }

  /* Gentle 3D tilt of the hero object toward the pointer. */
  function initParallax() {
    const hero = document.querySelector(".hero");
    const stage = document.querySelector(".hv-stage");
    if (!hero || !stage) return;
    const fine = window.matchMedia("(pointer: fine)");

    hero.addEventListener(
      "pointermove",
      (event) => {
        if (!motionOK() || !fine.matches) return;
        const rect = hero.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        stage.style.setProperty("--hv-ry", `${(x * 7).toFixed(2)}deg`);
        stage.style.setProperty("--hv-rx", `${(-y * 5).toFixed(2)}deg`);
      },
      { passive: true }
    );

    hero.addEventListener("pointerleave", () => {
      stage.style.setProperty("--hv-ry", "0deg");
      stage.style.setProperty("--hv-rx", "0deg");
    });
  }

  function initMailto() {
    const links = document.querySelectorAll("[data-mailto]");
    if (!CONTACT.email) {
      links.forEach((link) => {
        const wrap = link.closest("[data-mailto-wrap]");
        if (wrap) wrap.hidden = true;
        else link.hidden = true;
      });
      return;
    }
    links.forEach((link) => {
      link.setAttribute("href", `mailto:${CONTACT.email}?subject=${encodeURIComponent("FAUCHAR inquiry")}`);
    });
  }

  function initContact() {
    const form = document.getElementById("contact-form");
    const success = document.getElementById("form-success");
    const successText = document.getElementById("sent-modal-text") || document.getElementById("form-success-text");
    const reset = document.getElementById("form-reset");
    const modal = document.getElementById("sent-modal");
    const closeSent = document.getElementById("sent-close");
    if (!form || !successText) return;

    if (modal && closeSent) {
      closeSent.addEventListener("click", () => modal.close());
      modal.addEventListener("click", (event) => {
        if (event.target === modal) modal.close();
      });
      modal.addEventListener("close", () => {
        const submit = form.querySelector("[type='submit']");
        if (submit) submit.focus();
      });
    }

    const fields = {
      name: document.getElementById("contact-name"),
      email: document.getElementById("contact-email"),
      message: document.getElementById("contact-message"),
    };

    const showError = (input, message) => {
      const error = document.getElementById(input.getAttribute("aria-describedby"));
      input.setAttribute("aria-invalid", "true");
      if (error) {
        error.hidden = false;
        error.textContent = message;
      }
    };

    const clearError = (input) => {
      const error = document.getElementById(input.getAttribute("aria-describedby"));
      input.removeAttribute("aria-invalid");
      if (error) {
        error.hidden = true;
        error.textContent = "";
      }
    };

    Object.values(fields).forEach((input) => {
      input.addEventListener("input", () => clearError(input));
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      let invalid = null;

      const name = fields.name.value.trim();
      const email = fields.email.value.trim();
      const message = fields.message.value.trim();
      const organization = document.getElementById("contact-org").value.trim();
      const topicField = document.getElementById("contact-topic");
      const topic = topicField ? topicField.value : "";

      Object.values(fields).forEach(clearError);

      if (name.length < 2) {
        showError(fields.name, "Enter your name.");
        invalid = invalid || fields.name;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError(fields.email, "Enter a valid email address.");
        invalid = invalid || fields.email;
      }

      if (message.length < 12) {
        showError(fields.message, "Add a short message, at least a sentence.");
        invalid = invalid || fields.message;
      }

      if (invalid) {
        invalid.focus();
        return;
      }

      if (form.company_website && form.company_website.value) {
        finish("Thank you. Your note was received.");
        return;
      }

      const payload = { name, organization, email, topic, message };
      const endpoint = CONTACT.endpoint;

      if (typeof endpoint === "string" && endpoint.startsWith("mailto:")) {
        const subject = encodeURIComponent(`FAUCHAR inquiry — ${topic}`);
        const body = encodeURIComponent(
          `Name: ${name}\nOrganization: ${organization || "—"}\nEmail: ${email}\nTopic: ${topic}\n\n${message}`
        );
        window.location.href = `${endpoint}?subject=${subject}&body=${body}`;
        finish("Your mail app should open with this note.");
        return;
      }

      if (typeof endpoint === "string" && endpoint.startsWith("http")) {
        const submit = form.querySelector("[type='submit']");
        const label = submit ? submit.textContent : "";
        if (submit) {
          submit.disabled = true;
          submit.textContent = "Sending…";
        }
        try {
          const response = await fetch(endpoint, {
            method: CONTACT.method || "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!response.ok) throw new Error("Request failed");
          form.reset();
          finish(`${name}, your message has been sent. We will be in touch.`);
        } catch (error) {
          showError(fields.message, "The message could not be sent. Please try again.");
          fields.message.focus();
        } finally {
          if (submit) {
            submit.disabled = false;
            submit.textContent = label;
          }
        }
        return;
      }

      try {
        sessionStorage.setItem(
          "fauchar-contact",
          JSON.stringify({ ...payload, savedAt: new Date().toISOString() })
        );
      } catch (error) {
        // Storage can be unavailable (private mode); the preview still completes.
      }

      finish("This preview site is not yet connected to an inbox, so nothing has been sent. Your note is kept in this browser session only.");
    });

    function finish(text) {
      successText.textContent = text;
      if (modal && typeof modal.showModal === "function") {
        modal.showModal();
        return;
      }
      if (success) {
        form.hidden = true;
        success.hidden = false;
        success.focus();
      }
    }

    if (reset) {
      reset.addEventListener("click", () => {
        form.reset();
        success.hidden = true;
        form.hidden = false;
        fields.name.focus();
      });
    }
  }

  function initYear() {
    const year = String(new Date().getFullYear());
    document.querySelectorAll("[data-year]").forEach((node) => {
      node.textContent = year;
    });
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
}
