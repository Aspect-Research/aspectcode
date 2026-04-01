"""
Simple Python module to validate cross-language parser support.
"""
from dataclasses import dataclass
from typing import List


@dataclass
class Task:
    """A task in a to-do list."""
    id: int
    title: str
    done: bool = False


class TaskManager:
    """Manages a list of tasks."""

    def __init__(self) -> None:
        self._tasks: List[Task] = []
        self._next_id: int = 1

    def add(self, title: str) -> Task:
        task = Task(id=self._next_id, title=title)
        self._tasks.append(task)
        self._next_id += 1
        return task

    def complete(self, task_id: int) -> bool:
        for task in self._tasks:
            if task.id == task_id:
                task.done = True
                return True
        return False

    def list_pending(self) -> List[Task]:
        return [t for t in self._tasks if not t.done]


def main() -> None:
    mgr = TaskManager()
    mgr.add("Write tests")
    mgr.add("Ship v1")
    mgr.complete(1)
    for task in mgr.list_pending():
        print(f"TODO: {task.title}")
