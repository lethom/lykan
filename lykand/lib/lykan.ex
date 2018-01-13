defmodule Lykan do
  import Supervisor.Spec

  defmodule Connect do
    alias Socket.Web

    def server(port) do
      # setup a set of maps from a config file
      conf = Lykan.Config.from_env!("lykan.json")
      Enum.map(conf.maps, fn {m, attrs} ->
          Lykan.Map.spawn(m, attrs)
          Lkn.Core.Pool.spawn_pool(m)
        end)

      # listen for incoming connection
      server = Web.listen!(port)
      loop_acceptor(server, conf.default_map)
    end

    defp loop_acceptor(server, map_key) do
      client = Web.accept!(server)

      task(fn -> serve(client, map_key) end)
      loop_acceptor(server, map_key)
    end

    defp serve(client, map_key) do
      Socket.Web.accept!(client)

      # spawn a character for this player
      chara_key = UUID.uuid4()
      Lykan.Character.spawn(chara_key)

      # spawn a player puppeteer and find an instance
      puppeteer_key = UUID.uuid4()
      Lykan.Puppeteer.Player.start_link(puppeteer_key, client, chara_key)
      Lykan.Puppeteer.Player.goto(puppeteer_key, map_key)

      recv(puppeteer_key, client)
    end

    defp recv(puppeteer_key, client) do
      case Web.recv(client) do
        {:ok, {:text, msg}} ->
          Lykan.Puppeteer.Player.inject(puppeteer_key, msg)

          recv(puppeteer_key, client)
        _ ->
          Lkn.Core.Puppeteer.stop(puppeteer_key)
      end
    end

    defp task(lambda) do
      Task.Supervisor.start_child(Lykan.Tasks, lambda)
    end
  end

  def start(_type, _args) do
    children = [
      supervisor(Lykan.Repo, [[name: Lykan.Repo]], restart: :transient),
      supervisor(Lykan.Map.Sup, [], restart: :transient),
      supervisor(Lykan.Character.Sup, [], restart: :transient),
      supervisor(Task.Supervisor, [[name: Lykan.Tasks]], restart: :transient),
      worker(Task, [Connect, :server, [4000]], restart: :transient),
    ]

    Supervisor.start_link(children,
      strategy: :one_for_one,
      name: Lykan)
  end
end