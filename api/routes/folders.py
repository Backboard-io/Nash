import uuid
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify

from api.middleware.session_auth import require_auth
from api.services import state_service
from api.services.async_runner import run_async
from api.services.backboard_service import (
    get_request_assistant_id,
    get_request_client,
    get_request_state_partition,
)
from api.services.conversation_service import (
    add_thread_mapping,
    list_folder_conversation_ids,
    save_conversation_meta,
)

folders_bp = Blueprint("folders", __name__)


def _user_bb_client():
    return get_request_client()


def _folder_context_prompt(folder_name: str) -> str:
    return f"you are assistant working in {folder_name} folder."


def _effective_folder_prompt(folder_name: str, editable_prompt: str) -> str:
    context = _folder_context_prompt(folder_name)
    prompt = (editable_prompt or "").strip()
    if not prompt:
        return context
    return f"{context}\n\n{prompt}"


def _list_folders_for_user(user_id: str) -> list[dict]:
    return state_service.folders.list_for_user(user_id)


def _serialize_folder(row: dict) -> dict:
    return {k: v for k, v in row.items() if k not in ("pk", "sk")}


@folders_bp.route("/api/folders", methods=["GET"])
@require_auth
def get_folders():
    user_id = get_request_state_partition()
    folders = _list_folders_for_user(user_id)
    return jsonify([_serialize_folder(f) for f in folders])


@folders_bp.route("/api/folders", methods=["POST"])
@require_auth
def create_folder():
    data = request.get_json() or {}
    user_id = get_request_state_partition()
    bb = _user_bb_client()
    folder_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    name = data.get("name", "New Folder")

    async def _create_assistant():
        return await bb.create_assistant(
            name=f"nash-folder-{folder_id}",
            system_prompt=_effective_folder_prompt(name, ""),
        )

    bb_assistant = run_async(_create_assistant())

    folder = {
        "folderId": folder_id,
        "name": name,
        "type": data.get("type", "conversation"),
        "assistant_prompt": "",
        "bb_assistant_id": str(bb_assistant.assistant_id),
        "createdAt": now,
        "updatedAt": now,
    }
    state_service.folders.put(user_id, folder_id, folder)
    return jsonify(folder)


@folders_bp.route("/api/folders/<folder_id>", methods=["PATCH"])
@require_auth
def update_folder(folder_id):
    data = request.get_json() or {}
    user_id = get_request_state_partition()
    bb = _user_bb_client()

    folder = state_service.folders.get(user_id, folder_id)
    if not folder:
        return jsonify({"error": "Not found"}), 404

    if "name" in data:
        folder["name"] = data["name"]
    folder["updatedAt"] = datetime.now(timezone.utc).isoformat()
    editable_prompt = str(folder.get("assistant_prompt", "") or "")
    folder_name = str(folder.get("name", "New Folder") or "New Folder")
    bb_assistant_id = str(folder.get("bb_assistant_id", "") or "")

    state_service.folders.put(user_id, folder_id, _serialize_folder(folder))

    if bb_assistant_id:
        async def _sync_prompt():
            await bb.update_assistant(
                assistant_id=bb_assistant_id,
                system_prompt=_effective_folder_prompt(folder_name, editable_prompt),
            )
        try:
            run_async(_sync_prompt())
        except Exception:
            pass

    return jsonify(_serialize_folder(folder))


@folders_bp.route("/api/folders/<folder_id>/memories", methods=["GET"])
@require_auth
def list_folder_memories(folder_id):
    user_id = get_request_state_partition()
    bb = _user_bb_client()
    folder = state_service.folders.get(user_id, folder_id)
    if not folder:
        return jsonify({"error": "Folder not found or has no isolated assistant"}), 404
    target_assistant_id = folder.get("bb_assistant_id")
    if not target_assistant_id:
        return jsonify({"error": "Folder not found or has no isolated assistant"}), 404

    async def _fetch():
        response = await bb.get_memories(target_assistant_id)
        memories = []
        for m in response.memories:
            content = m.content or ""
            memories.append({
                "key": str(m.id),
                "value": content,
                "updated_at": str(getattr(m, "updated_at", None) or getattr(m, "created_at", None) or ""),
                "tokenCount": len(content.split()),
            })
        return memories

    memories = run_async(_fetch())
    return jsonify({"memories": memories})


@folders_bp.route("/api/folders/<folder_id>/memories/<memory_id>", methods=["DELETE"])
@require_auth
def delete_folder_memory(folder_id, memory_id):
    user_id = get_request_state_partition()
    bb = _user_bb_client()
    folder = state_service.folders.get(user_id, folder_id)
    if not folder:
        return jsonify({"error": "Folder not found or has no isolated assistant"}), 404
    target_assistant_id = folder.get("bb_assistant_id")
    if not target_assistant_id:
        return jsonify({"error": "Folder not found or has no isolated assistant"}), 404

    async def _del():
        await bb.delete_memory(assistant_id=target_assistant_id, memory_id=memory_id)

    try:
        run_async(_del())
    except Exception:
        pass
    return jsonify({"message": "Deleted"})


@folders_bp.route("/api/folders/<folder_id>/memories", methods=["POST"])
@require_auth
def create_folder_memory(folder_id):
    data = request.get_json() or {}
    user_id = get_request_state_partition()
    bb = _user_bb_client()
    folder = state_service.folders.get(user_id, folder_id)
    if not folder:
        return jsonify({"error": "Folder not found or has no isolated assistant"}), 404
    target_assistant_id = folder.get("bb_assistant_id")
    if not target_assistant_id:
        return jsonify({"error": "Folder not found or has no isolated assistant"}), 404

    key = data.get("key", "")
    value = data.get("value", "")
    if not value:
        return jsonify({"error": "value is required"}), 400

    content = f"{key}: {value}" if key else value

    async def _save():
        return await bb.add_memory(
            assistant_id=target_assistant_id,
            content=content,
        )

    result = run_async(_save())
    memory_id = ""
    if isinstance(result, dict):
        memory_id = str(result.get("id") or result.get("memory_id", ""))
    else:
        memory_id = str(getattr(result, "id", "") or getattr(result, "memory_id", ""))

    return jsonify({
        "created": True,
        "memory": {"key": memory_id, "value": value},
    }), 201


@folders_bp.route("/api/folders/<folder_id>/assistant-prompt", methods=["GET"])
@require_auth
def get_folder_assistant_prompt(folder_id):
    user_id = get_request_state_partition()
    folder = state_service.folders.get(user_id, folder_id)
    if not folder:
        return jsonify({"error": "Folder not found"}), 404

    folder_name = str(folder.get("name", "New Folder") or "New Folder")
    editable_prompt = str(folder.get("assistant_prompt", "") or "")
    return jsonify({
        "folder_context": _folder_context_prompt(folder_name),
        "system_prompt": editable_prompt,
    })


@folders_bp.route("/api/folders/<folder_id>/assistant-prompt", methods=["PATCH"])
@require_auth
def update_folder_assistant_prompt(folder_id):
    data = request.get_json(silent=True) or {}
    editable_prompt = data.get("system_prompt")
    if editable_prompt is None:
        return jsonify({"error": "system_prompt is required"}), 400
    editable_prompt = str(editable_prompt)

    user_id = get_request_state_partition()
    bb = _user_bb_client()
    folder = state_service.folders.get(user_id, folder_id)
    if not folder:
        return jsonify({"error": "Folder not found"}), 404

    folder_name = str(folder.get("name", "New Folder") or "New Folder")
    bb_assistant_id = str(folder.get("bb_assistant_id", "") or "")
    if not bb_assistant_id:
        return jsonify({"error": "Folder assistant missing"}), 404

    folder["assistant_prompt"] = editable_prompt
    folder["updatedAt"] = datetime.now(timezone.utc).isoformat()
    state_service.folders.put(user_id, folder_id, _serialize_folder(folder))

    async def _sync_prompt():
        await bb.update_assistant(
            assistant_id=bb_assistant_id,
            system_prompt=_effective_folder_prompt(folder_name, editable_prompt),
        )

    run_async(_sync_prompt())
    return jsonify({
        "folder_context": _folder_context_prompt(folder_name),
        "system_prompt": editable_prompt,
    })


@folders_bp.route("/api/folders/<folder_id>", methods=["DELETE"])
@require_auth
def delete_folder(folder_id):
    user_id = get_request_state_partition()
    bb = _user_bb_client()
    folder = state_service.folders.get(user_id, folder_id)
    if not folder:
        return jsonify({"error": "Not found"}), 404

    bb_assistant_id = folder.get("bb_assistant_id", "")
    if bb_assistant_id:
        # Un-folder the conversations first: re-key their threads to the main
        # assistant and clear folderId/hidden, otherwise they keep pointing at
        # the deleted folder and disappear from every listing.
        main_assistant_id = get_request_assistant_id()
        for entry in list_folder_conversation_ids(user_id, bb_assistant_id):
            cid = entry["conversationId"]
            if entry.get("threadId"):
                add_thread_mapping(user_id, cid, entry["threadId"], main_assistant_id)
            save_conversation_meta(user_id, cid, {"folderId": None, "hidden": False})

        async def _del_assistant():
            try:
                await bb.delete_assistant(bb_assistant_id)
            except Exception:
                pass
        run_async(_del_assistant())

    state_service.folders.delete(user_id, folder_id)
    return jsonify({"message": "Deleted"})
