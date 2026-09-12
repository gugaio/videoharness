export class InspectionNotFoundError extends Error {
  constructor() {
    super("inspeção não encontrada");
    this.name = "InspectionNotFoundError";
  }
}
