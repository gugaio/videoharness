import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CreateExperimentRequestSchema,
  CreateIterationRequestSchema,
  CreateTestEnvironmentRequestSchema,
  PreviewCloneSpecRequestSchema,
  QueueClonesRequestSchema,
  SubmitTestResultRequestSchema,
  ValidateCloneSpecRequestSchema,
} from "../../contracts/experiment.js";
import type { ExperimentService } from "../../experiment/application/experiments.js";
import { ApiError } from "../errors.js";

export function registerExperimentRoutes(server: FastifyInstance, service: ExperimentService): void {
  server.get("/v1/clone-capabilities", async () => ({ capabilities: service.listCapabilities() }));

  server.post<{ Body: unknown }>("/v1/clone-specs/validate", async (request) => {
    const parsed = ValidateCloneSpecRequestSchema.safeParse(request.body);
    if (!parsed.success) return { valid: false, errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`), warnings: [] };
    return service.validateSpec(parsed.data.spec as import("../../experiment/domain/clone-spec.js").CloneSpec);
  });

  server.post<{ Body: unknown }>("/v1/clone-specs/preview", async (request) => {
    const parsed = PreviewCloneSpecRequestSchema.safeParse(request.body);
    if (!parsed.success) throw invalid("INVALID_CLONE_PREVIEW", "Provide one valid CloneSpec or diagnostic recipe");
    return "spec" in parsed.data
      ? service.previewSpec(parsed.data.spec as import("../../experiment/domain/clone-spec.js").CloneSpec)
      : service.expandRecipe(parsed.data.recipe as unknown as Parameters<ExperimentService["expandRecipe"]>[0]);
  });

  server.post<{ Params: { id: string }; Body: unknown }>("/v1/investigations/:id/experiments", async (request, reply) => {
    const investigationId = uuid(request.params.id, "INVALID_INVESTIGATION_ID");
    const parsed = CreateExperimentRequestSchema.safeParse(request.body);
    if (!parsed.success) throw invalid("INVALID_EXPERIMENT", "Experiment goal and hypotheses are required");
    return reply.status(201).send({ experiment: await service.createExperiment(investigationId, parsed.data as unknown as Parameters<ExperimentService["createExperiment"]>[1]) });
  });

  server.get<{ Params: { id: string } }>("/v1/investigations/:id/experiments", async (request) => ({
    experiments: await service.listExperiments(uuid(request.params.id, "INVALID_INVESTIGATION_ID")),
  }));

  server.get<{ Params: { id: string } }>("/v1/experiments/:id", async (request) => {
    const experiment = await service.getExperiment(uuid(request.params.id, "INVALID_EXPERIMENT_ID"));
    if (!experiment) throw new ApiError(404, "EXPERIMENT_NOT_FOUND", "Experiment not found");
    return { experiment };
  });

  server.post<{ Params: { id: string }; Body: unknown }>("/v1/experiments/:id/iterations", async (request, reply) => {
    const parsed = CreateIterationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`).join("; ");
      throw invalid("INVALID_EXPERIMENT_ITERATION", `A rationale and one to four valid CloneSpecs are required. ${issues}`);
    }
    const iteration = await service.createIteration(uuid(request.params.id, "INVALID_EXPERIMENT_ID"), {
      rationale: parsed.data.rationale,
      cloneSpecs: parsed.data.cloneSpecs as unknown as import("../../experiment/domain/clone-spec.js").CloneSpec[],
    });
    return reply.status(201).send({ iteration });
  });

  server.get<{ Params: { id: string; iterationId: string } }>("/v1/experiments/:id/iterations/:iterationId", async (request) => {
    const experiment = await service.getExperiment(uuid(request.params.id, "INVALID_EXPERIMENT_ID"));
    if (!experiment) throw new ApiError(404, "EXPERIMENT_NOT_FOUND", "Experiment not found");
    const iterationId = uuid(request.params.iterationId, "INVALID_ITERATION_ID");
    const iteration = experiment.iterations.find((entry) => entry.id === iterationId);
    if (!iteration) throw new ApiError(404, "ITERATION_NOT_FOUND", "Experiment iteration not found");
    return {
      iteration,
      clones: experiment.clones.filter((entry) => entry.iterationId === iterationId),
      testRequests: experiment.testRequests.filter((entry) => entry.iterationId === iterationId),
    };
  });

  server.post<{ Params: { id: string }; Body: unknown }>("/v1/experiments/:id/clones", async (request, reply) => {
    const parsed = QueueClonesRequestSchema.safeParse(request.body);
    if (!parsed.success) throw invalid("INVALID_CLONE_REQUEST", "A valid iterationId is required");
    const experiment = await service.queueClones(uuid(request.params.id, "INVALID_EXPERIMENT_ID"), parsed.data.iterationId);
    return reply.status(202).send({ experiment });
  });

  server.get<{ Params: { id: string } }>("/v1/clones/:id", async (request) => {
    const clone = await service.getClone(uuid(request.params.id, "INVALID_CLONE_ID"));
    if (!clone) throw new ApiError(404, "CLONE_NOT_FOUND", "Clone not found");
    return { clone };
  });

  server.get<{ Params: { id: string } }>("/v1/experiments/:id/test-requests", async (request) => ({
    testRequests: await service.listTestRequests(uuid(request.params.id, "INVALID_EXPERIMENT_ID")),
  }));

  server.post<{ Params: { id: string } }>("/v1/test-requests/:id/activate", async (request) =>
    service.activateTestRequest(uuid(request.params.id, "INVALID_TEST_REQUEST_ID")));

  server.post<{ Params: { id: string }; Body: unknown }>("/v1/test-requests/:id/results", async (request, reply) => {
    const parsed = SubmitTestResultRequestSchema.safeParse(request.body);
    if (!parsed.success) throw invalid("INVALID_TEST_RESULT", "The structured test result is invalid");
    const result = await service.submitTestResult(uuid(request.params.id, "INVALID_TEST_REQUEST_ID"), parsed.data as unknown as Parameters<ExperimentService["submitTestResult"]>[1]);
    return reply.status(201).send({ result });
  });

  server.post<{ Params: { id: string } }>("/v1/experiments/:id/evaluate", async (request, reply) =>
    reply.status(202).send({ evaluationJob: await service.evaluate(uuid(request.params.id, "INVALID_EXPERIMENT_ID")) }));

  server.get("/v1/test-environments", async () => ({ environments: await service.listEnvironments() }));
  server.post<{ Body: unknown }>("/v1/test-environments", async (request, reply) => {
    const parsed = CreateTestEnvironmentRequestSchema.safeParse(request.body);
    if (!parsed.success) throw invalid("INVALID_TEST_ENVIRONMENT", "A valid test environment is required");
    return reply.status(201).send({ environment: await service.createEnvironment(parsed.data as unknown as Parameters<ExperimentService["createEnvironment"]>[0]) });
  });
}

function uuid(value: string, code: string): string {
  if (!z.string().uuid().safeParse(value).success) throw invalid(code, "ID must be a UUID");
  return value;
}
function invalid(code: string, message: string): ApiError { return new ApiError(400, code, message); }
