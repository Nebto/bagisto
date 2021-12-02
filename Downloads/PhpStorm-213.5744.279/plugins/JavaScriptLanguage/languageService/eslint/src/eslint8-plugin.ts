import {EslintPluginState, ESLintRequest, ESLintResponse, FileKind, RequestArguments} from "./eslint-api"
import {containsString, normalizePath, requireInContext} from "./eslint-common"

export class ESLint8Plugin implements LanguagePlugin {
  private static readonly GetErrors: string = "GetErrors";
  private static readonly FixErrors: string = "FixErrors";
  private readonly includeSourceText: boolean | null;
  private readonly additionalRulesDirectory?: string;
  private readonly ESLint: any;

  constructor(state: EslintPluginState) {
    this.includeSourceText = state.includeSourceText;
    this.additionalRulesDirectory = state.additionalRootDirectory;

    let eslintPackagePath = normalizePath(state.eslintPackagePath);
    this.ESLint = requireInContext(eslintPackagePath + "lib/api", state.packageJsonPath).ESLint;
  }

  async onMessage(p: string, writer: MessageWriter) {
    const request: ESLintRequest = JSON.parse(p);
    let response: ESLintResponse = new ESLintResponse(request.seq, request.command);
    try {
      if (request.command === ESLint8Plugin.GetErrors) {
        let lintResults: ESLint.LintResult[] = await this.getErrors(request.arguments);
        response.body = {results: this.filterSourceIfNeeded(lintResults)};
      }
      else if (request.command === ESLint8Plugin.FixErrors) {
        let lintResults: ESLint.LintResult[] = await this.fixErrors(request.arguments);
        response.body = {results: this.filterSourceIfNeeded(lintResults)};
      }
      else {
        response.error = `Unknown command: ${request.command}`
      }
    }
    catch (e) {
      response.isNoConfigFile = "no-config-found" === e.messageTemplate
        || (e.message && containsString(e.message.toString(), "No ESLint configuration found"));
      response.error = e.toString() + "\n\n" + e.stack;
    }
    writer.write(JSON.stringify(response));
  }

  private filterSourceIfNeeded(results: ESLint.LintResult[]): ESLint.LintResult[] {
    if (!this.includeSourceText) {
      results.forEach(value => {
        delete value.source
        value.messages.forEach(msg => delete msg.source)
      })
    }
    return results
  }

  private async getErrors(getErrorsArguments: RequestArguments): Promise<ESLint.LintResult[]> {
    return this.invokeESLint(getErrorsArguments)
  }

  private async fixErrors(fixErrorsArguments: RequestArguments): Promise<ESLint.LintResult[]> {
    return this.invokeESLint(fixErrorsArguments, {fix: true})
  }

  private async invokeESLint(requestArguments: RequestArguments, additionalOptions: ESLint.Options = {}): Promise<ESLint.LintResult[]> {
    const parsedCommandLineOptions = {}; // todo prefill with parsed requestArguments.extraOptions
    const options: ESLint.Options = {...parsedCommandLineOptions, ...additionalOptions};

    options.ignorePath = requestArguments.ignoreFilePath;

    if (requestArguments.configPath != null) {
      options.overrideConfigFile = requestArguments.configPath;
    }

    if (this.additionalRulesDirectory != null && this.additionalRulesDirectory.length > 0) {
      if (options.rulePaths == null) {
        options.rulePaths = [this.additionalRulesDirectory]
      }
      else {
        options.rulePaths.push(this.additionalRulesDirectory);
      }
    }

    const eslint = new this.ESLint(options);

    if (requestArguments.fileKind === FileKind.html) {
      const config: any = await eslint.calculateConfigForFile(requestArguments.fileName);
      const plugins: string[] | null | undefined = config.plugins;

      if (!Array.isArray(plugins) || !plugins.includes("html")) {
        return [];
      }
    }

    if (await eslint.isPathIgnored(requestArguments.fileName)) {
      return [];
    }

    return eslint.lintText(requestArguments.content, {filePath: requestArguments.fileName});
  }
}

