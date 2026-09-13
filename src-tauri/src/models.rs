use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum NoteSize {
    S,
    M,
    L,
}

impl NoteSize {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::S => "S",
            Self::M => "M",
            Self::L => "L",
        }
    }

    pub(crate) fn from_database(value: &str) -> Option<Self> {
        match value {
            "S" => Some(Self::S),
            "M" => Some(Self::M),
            "L" => Some(Self::L),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DrawingScene {
    pub schema_version: u32,
    pub engine: String,
    pub background_color: String,
    pub elements: Vec<Value>,
}

impl DrawingScene {
    pub fn empty() -> Self {
        Self {
            schema_version: 1,
            engine: "songtie-svg".to_owned(),
            background_color: "transparent".to_owned(),
            elements: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    pub x: f64,
    pub y: f64,
    pub z: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WallBounds {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub size: NoteSize,
    pub position: Position,
    pub scene: DrawingScene,
    pub passive_date: Option<String>,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Wall {
    pub id: String,
    pub bounds: WallBounds,
    pub scene: DrawingScene,
    pub revision: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompletedNote {
    pub id: String,
    pub size: NoteSize,
    pub scene: DrawingScene,
    pub completed_on: String,
    pub completed_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppStatePayload {
    pub wall: Option<Wall>,
    pub notes: Vec<Note>,
    pub completed_notes: Vec<CompletedNote>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuickNotePlacement {
    pub id: String,
    pub size: NoteSize,
    pub position: Position,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuickStatePayload {
    pub wall_bounds: Option<WallBounds>,
    pub notes: Vec<QuickNotePlacement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteInput {
    pub note: Note,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNoteInput {
    pub note: Note,
    pub expected_revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeWallInput {
    pub wall: Wall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveWallInput {
    pub wall: Wall,
    pub expected_revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteNoteInput {
    pub id: String,
    pub expected_revision: i64,
    pub completed: CompletedNote,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteNoteInput {
    pub id: String,
    pub expected_revision: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
}
