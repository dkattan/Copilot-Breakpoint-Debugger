var builder = WebApplication.CreateBuilder(args);

var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapGet("/api/echo/{text}", (string text) => Results.Ok(new { echo = text }));

app.MapPost("/api/echo", (EchoRequest request) => Results.Ok(new { echo = request.Text }));

app.Run();

internal sealed record EchoRequest(string Text);
