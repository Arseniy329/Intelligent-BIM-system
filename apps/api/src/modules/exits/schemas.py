"""BIM-75: моделі виходу і проходу для API (формат погоджується з BIM-182).

Моделі лежать поруч із модулем, а не в packages/contracts: формат ще треба погодити
з Михайлом (план) — після цього їх можна перенести в контракти без зміни полів.
"""

from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from src.contracts.generated import Point

Name = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]


class ExitSource(StrEnum):
    dxf = "dxf"
    manual = "manual"


class Exit(BaseModel):
    """Евакуаційний вихід на плані: точка дверей у координатах креслення."""

    model_config = ConfigDict(extra="forbid")

    id: str
    drawingId: UUID
    roomId: str | None = Field(
        default=None, description="Приміщення біля виходу або null"
    )
    name: str | None = None
    position: Point
    source: ExitSource = Field(
        description="dxf — знайдено в кресленні (шар EXITS або підпис «Вихід»); "
        "manual — позначено інженером на плані"
    )


class ExitCreateRequest(BaseModel):
    """Тіло POST /drawings/{id}/exits — інженер вибрав двері на плані."""

    model_config = ConfigDict(extra="forbid")

    position: Point
    name: Name | None = None


class Passage(BaseModel):
    """Прохід між приміщеннями: двері або отвір, через які можна пройти.

    Близькі контури приміщень проходу не доводять (між ними може бути стіна), тому
    маршрут евакуації між приміщеннями будується лише через такі точки.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    drawingId: UUID
    name: str | None = None
    position: Point
    source: ExitSource = Field(
        description="dxf — двері, знайдені в кресленні; "
        "manual — прохід, підтверджений інженером на плані"
    )


class PassageCreateRequest(BaseModel):
    """Тіло POST /drawings/{id}/passages — інженер підтвердив прохід на плані."""

    model_config = ConfigDict(extra="forbid")

    position: Point
    name: Name | None = None
