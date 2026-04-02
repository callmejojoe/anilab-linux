mod db;
mod anilist;
mod scanner;
mod matcher;
mod player;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            db::init_db,
            db::save_to_library,
            db::get_library,
            db::mark_watched,
            db::remove_from_library,
            anilist::search_anime,
            scanner::scan_folder,
            matcher::match_anime,
            player::play_episode
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

