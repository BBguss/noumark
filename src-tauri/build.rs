fn main() {
    // tauri-build embeds icons/icon.ico into the Windows executable but doesn't
    // ask Cargo to re-run when it changes, so a new icon would otherwise be ignored.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
