(function () {
  "use strict";

  var STORAGE_KEY = "nursing-medication-reminders-v1";
  var TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

  var form = document.getElementById("medicineForm");
  var formCard = document.getElementById("formCard");
  var formTitle = document.getElementById("formTitle");
  var submitIcon = document.getElementById("submitIcon");
  var submitButtonText = document.getElementById("submitButtonText");
  var cancelEditButton = document.getElementById("cancelEditButton");
  var nameInput = document.getElementById("medicineName");
  var dosageInput = document.getElementById("dosage");
  var timeInput = document.getElementById("reminderTime");
  var noteInput = document.getElementById("note");
  var nameField = document.getElementById("nameField");
  var timeField = document.getElementById("timeField");
  var nameError = document.getElementById("nameError");
  var timeError = document.getElementById("timeError");
  var medicineList = document.getElementById("medicineList");
  var medicineCount = document.getElementById("medicineCount");
  var emptyState = document.getElementById("emptyState");
  var currentTime = document.getElementById("currentTime");
  var currentDate = document.getElementById("currentDate");
  var overviewTotal = document.getElementById("overviewTotal");
  var overviewTaken = document.getElementById("overviewTaken");
  var overviewPending = document.getElementById("overviewPending");
  var overviewProgressBar = document.getElementById("overviewProgressBar");
  var overviewProgress = document.getElementById("overviewProgress");
  var overviewSummary = document.getElementById("overviewSummary");
  var toast = document.getElementById("toast");
  var notificationButton = document.getElementById("notificationButton");
  var notificationStatus = document.getElementById("notificationStatus");
  var reminderBanner = document.getElementById("reminderBanner");
  var reminderBannerText = document.getElementById("reminderBannerText");
  var dismissReminderButton = document.getElementById("dismissReminder");

  var notificationApiAvailable = "Notification" in window;
  var notificationsSupported =
    notificationApiAvailable && window.isSecureContext === true;

  var medicines = loadMedicines();
  var reminderTimer = null;
  var toastTimer = null;
  var lastCheckedDate = "";
  var activeReminderIds = [];
  var editingId = null;

  var clockFormatter = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  var dateFormatter = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  /* ---------------- 数据读写 ---------------- */

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "med-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function isValidStoredMedicine(item) {
    return (
      item &&
      typeof item === "object" &&
      typeof item.name === "string" &&
      item.name.trim() !== "" &&
      typeof item.time === "string" &&
      TIME_PATTERN.test(item.time)
    );
  }

  function loadMedicines() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }

      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter(isValidStoredMedicine).map(function (item) {
        return {
          id:
            typeof item.id === "string" && item.id !== ""
              ? item.id
              : createId(),
          name: item.name.trim().slice(0, 40),
          dosage:
            typeof item.dosage === "string"
              ? item.dosage.trim().slice(0, 30)
              : "",
          time: item.time,
          note:
            typeof item.note === "string"
              ? item.note.trim().slice(0, 100)
              : "",
          lastNotified:
            typeof item.lastNotified === "string" ? item.lastNotified : "",
          // 新字段为 lastTaken；兼容旧版本使用的 takenOn。
          lastTaken:
            typeof item.lastTaken === "string"
              ? item.lastTaken
              : typeof item.takenOn === "string"
                ? item.takenOn
                : "",
        };
      });
    } catch (error) {
      console.warn("读取用药数据失败：", error);
      return [];
    }
  }

  function saveMedicines() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(medicines));
      return true;
    } catch (error) {
      console.warn("保存用药数据失败：", error);
      showToast("保存失败，请检查浏览器的本地存储设置", true);
      return false;
    }
  }

  /* ---------------- 表单与列表 ---------------- */

  function setFieldError(input, field, errorElement, message) {
    field.classList.add("has-error");
    input.setAttribute("aria-invalid", "true");
    errorElement.textContent = message;
  }

  function clearFieldError(input, field, errorElement) {
    field.classList.remove("has-error");
    input.removeAttribute("aria-invalid");
    errorElement.textContent = "";
  }

  function clearAllErrors() {
    clearFieldError(nameInput, nameField, nameError);
    clearFieldError(timeInput, timeField, timeError);
  }

  function scrollFormIntoView() {
    var reduceMotion =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    formCard.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
  }

  function resetFormToAddMode() {
    editingId = null;
    form.reset();
    clearAllErrors();
    formCard.classList.remove("is-editing");
    formTitle.textContent = "添加药品";
    submitIcon.textContent = "＋";
    submitButtonText.textContent = "添加提醒";
    cancelEditButton.hidden = true;
  }

  function enterEditMode(medicine) {
    editingId = medicine.id;
    clearAllErrors();

    nameInput.value = medicine.name;
    dosageInput.value = medicine.dosage;
    timeInput.value = medicine.time;
    noteInput.value = medicine.note;

    formCard.classList.add("is-editing");
    formTitle.textContent = "编辑药品";
    submitIcon.textContent = "✓";
    submitButtonText.textContent = "保存修改";
    cancelEditButton.hidden = false;

    scrollFormIntoView();
    nameInput.focus({ preventScroll: true });
  }

  function twoDigits(value) {
    return String(value).padStart(2, "0");
  }

  function getTimeKey(date) {
    return twoDigits(date.getHours()) + ":" + twoDigits(date.getMinutes());
  }

  function getDateKey(date) {
    return (
      date.getFullYear() +
      "-" +
      twoDigits(date.getMonth() + 1) +
      "-" +
      twoDigits(date.getDate())
    );
  }

  function getSortedMedicines() {
    return medicines.slice().sort(function (a, b) {
      var timeCompare = a.time.localeCompare(b.time);
      return timeCompare !== 0
        ? timeCompare
        : a.name.localeCompare(b.name, "zh-CN");
    });
  }

  function updateOverview() {
    var today = getDateKey(new Date());
    var total = medicines.length;
    var taken = medicines.reduce(function (count, medicine) {
      return count + (medicine.lastTaken === today ? 1 : 0);
    }, 0);
    var pending = Math.max(0, total - taken);
    var percent = total === 0 ? 0 : Math.round((taken / total) * 100);

    overviewTotal.textContent = String(total);
    overviewTaken.textContent = String(taken);
    overviewPending.textContent = String(pending);
    overviewProgress.style.width = percent + "%";
    overviewProgressBar.setAttribute("aria-valuenow", String(percent));
    overviewProgressBar.setAttribute(
      "aria-valuetext",
      taken + " / " + total + "，完成 " + percent + "%"
    );
    overviewSummary.textContent =
      "今日应服 " +
      total +
      " 种，已服 " +
      taken +
      " 种，待服 " +
      pending +
      " 种";
  }

  function renderMedicines() {
    var sorted = getSortedMedicines();
    var today = getDateKey(new Date());

    medicineList.replaceChildren();
    medicineCount.textContent = "共 " + sorted.length + " 项";
    emptyState.classList.toggle("is-visible", sorted.length === 0);
    medicineList.hidden = sorted.length === 0;

    sorted.forEach(function (medicine) {
      var isTaken = medicine.lastTaken === today;
      var isNotified = !isTaken && medicine.lastNotified === today;

      var item = document.createElement("li");
      item.className =
        "medicine-item" +
        (isTaken ? " is-taken" : isNotified ? " is-notified" : "");

      var timeChip = document.createElement("div");
      timeChip.className = "time-chip";

      var timeText = document.createElement("strong");
      timeText.textContent = medicine.time;

      var frequencyText = document.createElement("span");
      frequencyText.textContent = "每日";

      timeChip.append(timeText, frequencyText);

      var info = document.createElement("div");
      info.className = "med-info";

      var name = document.createElement("h3");
      name.className = "med-name";
      name.textContent = medicine.name;

      var meta = document.createElement("div");
      meta.className = "med-meta";

      if (medicine.dosage) {
        var dosage = document.createElement("span");
        dosage.className = "dose-tag";
        dosage.textContent = medicine.dosage;
        meta.append(dosage);
      }

      var status = document.createElement("span");
      status.className =
        "status-tag" +
        (isTaken ? " is-taken" : isNotified ? " is-notified" : "");
      status.textContent = isTaken
        ? "今日已服"
        : isNotified
          ? "已提醒 · 待服用"
          : "待提醒";
      meta.append(status);

      info.append(name, meta);

      if (medicine.note) {
        var note = document.createElement("p");
        note.className = "med-note";
        note.textContent = medicine.note;
        info.append(note);
      }

      var actions = document.createElement("div");
      actions.className = "med-actions";

      var takeButton = document.createElement("button");
      takeButton.type = "button";
      takeButton.className = "take-btn" + (isTaken ? " is-taken" : "");
      takeButton.dataset.action = "take";
      takeButton.dataset.id = medicine.id;
      takeButton.setAttribute("aria-pressed", String(isTaken));
      takeButton.setAttribute(
        "aria-label",
        isTaken
          ? "撤销 " + medicine.name + " 的今日已服标记"
          : "标记 " + medicine.name + " 今日已服"
      );
      takeButton.textContent = isTaken ? "撤销" : "已服用";

      var editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "edit-btn";
      editButton.dataset.action = "edit";
      editButton.dataset.id = medicine.id;
      editButton.setAttribute(
        "aria-label",
        "编辑 " + medicine.name + " 的用药提醒"
      );
      editButton.textContent = "编辑";

      var deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-btn";
      deleteButton.dataset.action = "delete";
      deleteButton.dataset.id = medicine.id;
      deleteButton.setAttribute(
        "aria-label",
        "删除 " + medicine.name + " 的用药提醒"
      );
      deleteButton.textContent = "删除";

      actions.append(takeButton, editButton, deleteButton);
      item.append(timeChip, info, actions);
      medicineList.append(item);
    });

    updateOverview();
  }

  function showToast(message, isError) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.toggle("is-error", Boolean(isError));
    toast.classList.add("is-show");

    toastTimer = window.setTimeout(function () {
      toast.classList.remove("is-show");
    }, 2400);
  }

  function hideReminderBanner() {
    reminderBanner.hidden = true;
    reminderBannerText.textContent = "";
    activeReminderIds = [];
  }

  function hideReminderBannerIfResolved() {
    if (activeReminderIds.length === 0) {
      return;
    }

    var today = getDateKey(new Date());
    var hasUnresolved = activeReminderIds.some(function (id) {
      var medicine = medicines.find(function (item) {
        return item.id === id;
      });
      return medicine && medicine.lastTaken !== today;
    });

    if (!hasUnresolved) {
      hideReminderBanner();
    }
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearAllErrors();

    var name = nameInput.value.trim();
    var time = timeInput.value;
    var hasError = false;

    if (!name) {
      setFieldError(nameInput, nameField, nameError, "请填写药品名称");
      hasError = true;
    }

    if (!TIME_PATTERN.test(time)) {
      setFieldError(timeInput, timeField, timeError, "请选择有效的提醒时间");
      hasError = true;
    }

    if (hasError) {
      var firstInvalid = form.querySelector(".field.has-error input");
      if (firstInvalid) {
        firstInvalid.focus();
      }
      return;
    }

    var dosage = dosageInput.value.trim().slice(0, 30);
    var note = noteInput.value.trim().slice(0, 100);
    var today = getDateKey(new Date());

    if (editingId !== null) {
      var editingMedicine = medicines.find(function (item) {
        return item.id === editingId;
      });

      if (!editingMedicine) {
        resetFormToAddMode();
        renderMedicines();
        showToast("正在编辑的药品已不存在，已退出编辑", true);
        return;
      }

      var timeChanged = editingMedicine.time !== time;

      editingMedicine.name = name.slice(0, 40);
      editingMedicine.dosage = dosage;
      editingMedicine.time = time;
      editingMedicine.note = note;

      // 修改提醒时间后，允许在新时间重新提醒。
      if (timeChanged) {
        editingMedicine.lastNotified = "";
      }

      saveMedicines();
      renderMedicines();
      resetFormToAddMode();
      showToast("已保存修改：" + editingMedicine.name);
      checkReminders();
      return;
    }

    var medicine = {
      id: createId(),
      name: name.slice(0, 40),
      dosage: dosage,
      time: time,
      note: note,
      lastNotified: "",
      lastTaken: "",
    };

    medicines.push(medicine);
    saveMedicines();
    renderMedicines();

    resetFormToAddMode();
    nameInput.focus();
    showToast("已添加：" + medicine.name + " · 每天 " + medicine.time);

    // 若添加的正是当前分钟，立即走一次到点检查。
    checkReminders();
  });

  cancelEditButton.addEventListener("click", function () {
    resetFormToAddMode();
    nameInput.focus();
    showToast("已取消编辑");
  });

  nameInput.addEventListener("input", function () {
    if (nameField.classList.contains("has-error")) {
      clearFieldError(nameInput, nameField, nameError);
    }
  });

  timeInput.addEventListener("input", function () {
    if (timeField.classList.contains("has-error")) {
      clearFieldError(timeInput, timeField, timeError);
    }
  });

  medicineList.addEventListener("click", function (event) {
    var button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    var id = button.dataset.id;
    var medicine = medicines.find(function (item) {
      return item.id === id;
    });

    if (!medicine) {
      return;
    }

    if (button.dataset.action === "edit") {
      enterEditMode(medicine);
      return;
    }

    if (button.dataset.action === "take") {
      var today = getDateKey(new Date());

      if (medicine.lastTaken === today) {
        medicine.lastTaken = "";
        showToast("已撤销今日已服标记");
      } else {
        medicine.lastTaken = today;
        showToast("已记录：" + medicine.name + " 今日已服");
      }

      saveMedicines();
      renderMedicines();
      hideReminderBannerIfResolved();
      return;
    }

    if (button.dataset.action === "delete") {
      var confirmed = window.confirm(
        "确定删除“" + medicine.name + "”的用药提醒吗？"
      );

      if (!confirmed) {
        return;
      }

      var wasEditingThisMedicine = editingId === id;

      medicines = medicines.filter(function (item) {
        return item.id !== id;
      });

      saveMedicines();
      renderMedicines();
      hideReminderBannerIfResolved();

      if (wasEditingThisMedicine) {
        resetFormToAddMode();
        showToast("已删除正在编辑的药品，已退出编辑");
      } else {
        showToast("已删除该提醒");
      }
    }
  });

  dismissReminderButton.addEventListener("click", hideReminderBanner);

  /* ---------------- 系统通知 ---------------- */

  function getNotificationPermission() {
    if (!notificationsSupported) {
      return "unsupported";
    }

    try {
      return Notification.permission;
    } catch (error) {
      console.warn("读取通知权限失败：", error);
      return "unsupported";
    }
  }

  function updateNotificationUI() {
    notificationButton.classList.remove("is-blocked");
    notificationButton.disabled = false;

    if (!notificationApiAvailable) {
      notificationStatus.textContent =
        "当前浏览器不支持系统通知，到点将显示页面内提醒。";
      notificationButton.textContent = "不支持";
      notificationButton.disabled = true;
      return;
    }

    if (!notificationsSupported) {
      notificationStatus.textContent =
        "系统通知需要 HTTPS 或 localhost，当前将使用页面内提醒。";
      notificationButton.textContent = "需 HTTPS";
      notificationButton.disabled = true;
      return;
    }

    var permission = getNotificationPermission();

    if (permission === "granted") {
      notificationStatus.textContent = "已开启，到点会发送系统通知。";
      notificationButton.textContent = "已开启";
      notificationButton.disabled = true;
      return;
    }

    if (permission === "denied") {
      notificationStatus.textContent =
        "通知权限被拒绝，请在浏览器站点设置中允许通知。";
      notificationButton.textContent = "重新检查";
      notificationButton.classList.add("is-blocked");
      return;
    }

    if (permission === "unsupported") {
      notificationStatus.textContent =
        "当前环境无法使用系统通知，到点将显示页面内提醒。";
      notificationButton.textContent = "不可用";
      notificationButton.disabled = true;
      return;
    }

    notificationStatus.textContent =
      "未开启，到点将显示页面内提醒；开启后可收到系统通知。";
    notificationButton.textContent = "开启通知";
  }

  function sendNotification(title, options, tag) {
    try {
      var notification = new Notification(title, {
        body: options.body,
        tag: tag,
        lang: "zh-CN",
        dir: "auto",
        requireInteraction: true,
      });

      notification.onclick = function () {
        window.focus();
        notification.close();
      };

      return true;
    } catch (error) {
      console.warn("发送系统通知失败：", error);
      return false;
    }
  }

  async function requestNotificationPermission() {
    updateNotificationUI();

    if (!notificationsSupported) {
      return;
    }

    var currentPermission = getNotificationPermission();

    if (currentPermission === "granted") {
      updateNotificationUI();
      return;
    }

    if (currentPermission === "denied") {
      showToast("通知已被浏览器拦截，请在站点设置中允许通知", true);
      return;
    }

    notificationButton.disabled = true;
    notificationButton.textContent = "请求中…";

    try {
      var permission = await Notification.requestPermission();
      updateNotificationUI();

      if (permission === "granted") {
        showToast("系统通知已开启");
        sendNotification(
          "系统通知已开启",
          {
            body: "护理用药提醒已准备好，到点会通知你。",
          },
          "medication-permission-test"
        );
      } else if (permission === "denied") {
        showToast("通知权限未开启，将使用页面内提醒", true);
      }
    } catch (error) {
      console.warn("请求通知权限失败：", error);
      updateNotificationUI();
      showToast("无法开启系统通知，将使用页面内提醒", true);
    }
  }

  notificationButton.addEventListener("click", requestNotificationPermission);

  /* ---------------- 时钟与提醒 ---------------- */

  function updateClock() {
    var now = new Date();
    currentTime.textContent = clockFormatter.format(now);
    currentDate.textContent = dateFormatter.format(now);
  }

  function formatMedicineBrief(medicine) {
    return medicine.dosage
      ? medicine.name + "（" + medicine.dosage + "）"
      : medicine.name;
  }

  function showInPageReminder(dueMedicines, time) {
    activeReminderIds = dueMedicines.map(function (medicine) {
      return medicine.id;
    });

    reminderBannerText.textContent =
      "现在 " +
      time +
      "，该服用：" +
      dueMedicines.map(formatMedicineBrief).join("、") +
      "。服用后请点击「已服用」。";
    reminderBanner.hidden = false;
    showToast("⏰ 有药品到服用时间了");
  }

  function deliverReminders(dueMedicines, time, today) {
    var notificationSentCount = 0;

    if (getNotificationPermission() === "granted") {
      dueMedicines.forEach(function (medicine) {
        var bodyLines = ["时间：" + time];
        if (medicine.dosage) {
          bodyLines.push("剂量：" + medicine.dosage);
        }
        if (medicine.note) {
          bodyLines.push("备注：" + medicine.note);
        }
        bodyLines.push("服用后请在页面中点击「已服用」。");

        var sent = sendNotification(
          "💊 用药提醒 · " + medicine.name,
          { body: bodyLines.join("\n") },
          "medication-" + medicine.id + "-" + today
        );

        if (sent) {
          notificationSentCount += 1;
        }
      });
    }

    if (notificationSentCount < dueMedicines.length) {
      showInPageReminder(dueMedicines, time);
    }
  }

  function checkReminders() {
    var now = new Date();
    var currentTimeKey = getTimeKey(now);
    var today = getDateKey(now);
    var dateChanged = today !== lastCheckedDate;
    lastCheckedDate = today;

    if (dateChanged) {
      hideReminderBanner();
      renderMedicines();
    }

    var dueMedicines = medicines.filter(function (medicine) {
      return (
        medicine.time === currentTimeKey &&
        medicine.lastNotified !== today &&
        medicine.lastTaken !== today
      );
    });

    if (dueMedicines.length === 0) {
      return;
    }

    dueMedicines.forEach(function (medicine) {
      medicine.lastNotified = today;
    });

    saveMedicines();
    renderMedicines();
    deliverReminders(dueMedicines, currentTimeKey, today);
  }

  function scheduleReminderCheck() {
    if (reminderTimer !== null) {
      window.clearTimeout(reminderTimer);
    }

    var now = new Date();
    var elapsedInMinute = now.getSeconds() * 1000 + now.getMilliseconds();
    var delay = 60000 - elapsedInMinute + 30;

    reminderTimer = window.setTimeout(function () {
      checkReminders();
      scheduleReminderCheck();
    }, delay);
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      updateClock();
      updateNotificationUI();
      checkReminders();
      scheduleReminderCheck();
    }
  });

  /* ---------------- 初始化 ---------------- */

  updateClock();
  renderMedicines();
  updateNotificationUI();
  checkReminders();
  scheduleReminderCheck();
  window.setInterval(updateClock, 1000);
})();
