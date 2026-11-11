// Full profiles bundle the avatar, background image, and settings. The server
// keeps a copy of each asset per profile, so applying a profile never uploads
// the same 15 MB avatar again. This module only wires the panel controls.
export const MAX_PROFILE_NAME = 32;

export function normalizeProfileName(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PROFILE_NAME);
}

export function describeProfile(profile) {
  const marks = [];
  if (profile?.hasAvatar) marks.push("avatar");
  if (profile?.hasBackground) marks.push("latar");
  return marks.length ? `${profile.name} · ${marks.join(" + ")}` : String(profile?.name ?? "");
}

async function readError(res, fallback) {
  try {
    const data = await res.json();
    return data?.error || fallback;
  } catch {
    return fallback;
  }
}

export function setupProfiles({ $, toast, flushSettings, reloadFromServer }) {
  let profiles = [];
  let busy = false;

  const selectedId = () => $("profileList").value;

  function updateButtons() {
    const selected = selectedId();
    $("profileApply").disabled = !selected;
    $("profileDelete").disabled = !selected;
  }

  function renderOptions(selected = selectedId()) {
    const select = $("profileList");
    select.innerHTML = "";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "— belum dipilih —";
    select.append(none);
    for (const profile of profiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = describeProfile(profile);
      select.append(option);
    }
    select.value = profiles.some((profile) => profile.id === selected) ? selected : "";
    updateButtons();
  }

  async function refresh(selected = selectedId()) {
    try {
      const res = await fetch("/api/profiles", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      profiles = Array.isArray(data?.profiles) ? data.profiles : [];
    } catch {
      profiles = [];
    }
    renderOptions(selected);
    return profiles;
  }

  // One request at a time keeps a double click from creating two profiles.
  async function run(work) {
    if (busy) return;
    busy = true;
    try {
      await work();
    } finally {
      busy = false;
    }
  }

  $("profileList").addEventListener("change", updateButtons);

  $("profileSave").addEventListener("click", () =>
    run(async () => {
      const current = profiles.find((profile) => profile.id === selectedId());
      const name = normalizeProfileName($("profileName").value) || current?.name || "";
      if (!name) {
        toast("Beri nama profil dulu.");
        return;
      }
      // Settings are pushed with a short debounce; save the latest values first.
      await flushSettings();
      try {
        const res = await fetch("/api/profiles", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) throw new Error(await readError(res, "Gagal menyimpan profil."));
        const data = await res.json();
        $("profileName").value = "";
        await refresh(data?.profile?.id || "");
        toast(
          data?.replaced ? `Profil "${name}" diperbarui` : `Profil "${name}" disimpan`,
        );
      } catch (err) {
        toast(String(err.message || err));
      }
    }),
  );

  $("profileApply").addEventListener("click", () =>
    run(async () => {
      const id = selectedId();
      if (!id) {
        toast("Pilih profil dulu.");
        return;
      }
      try {
        const res = await fetch(`/api/profiles/${id}/apply`, { method: "POST" });
        if (!res.ok) throw new Error(await readError(res, "Gagal menerapkan profil."));
        const data = await res.json();
        await reloadFromServer();
        toast(`Profil "${data?.name || "dipilih"}" diterapkan`);
      } catch (err) {
        toast(String(err.message || err));
      }
    }),
  );

  $("profileDelete").addEventListener("click", () =>
    run(async () => {
      const profile = profiles.find((item) => item.id === selectedId());
      if (!profile) return;
      if (!window.confirm(`Hapus profil "${profile.name}"? File avatar dan latarnya ikut dihapus.`)) {
        return;
      }
      try {
        const res = await fetch(`/api/profiles/${profile.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(await readError(res, "Gagal menghapus profil."));
        await refresh("");
        toast(`Profil "${profile.name}" dihapus`);
      } catch (err) {
        toast(String(err.message || err));
      }
    }),
  );

  refresh("");
  return { refresh };
}
