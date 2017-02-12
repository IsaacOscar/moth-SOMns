package tools.debugger.message;

import org.java_websocket.WebSocket;

import com.oracle.truffle.api.debug.SuspendedEvent;

import tools.debugger.FrontendConnector;
import tools.debugger.frontend.Suspension;
import tools.debugger.message.Message.IncommingMessage;

public abstract class StepMessage extends IncommingMessage {
  private final long activityId;

  /**
   * Note: meant for serialization.
   */
  protected StepMessage() {
    activityId = -1;
  }

  @Override
  public void process(final FrontendConnector connector, final WebSocket conn) {
    Suspension susp = connector.getSuspension(activityId);
    assert susp.getEvent() != null : "didn't find SuspendEvent";
    process(susp.getEvent());
    susp.resume();
  }

  public abstract void process(SuspendedEvent event);

  public static class StepInto extends StepMessage {
    @Override
    public void process(final SuspendedEvent event) {
      event.prepareStepInto(1);
    }
  }

  public static class StepOver extends StepMessage {
    @Override
    public void process(final SuspendedEvent event) {
      event.prepareStepOver(1);
    }
  }

  public static class Return extends StepMessage {
    @Override
    public void process(final SuspendedEvent event) {
      event.prepareStepOut();
    }
  }

  public static class Resume extends StepMessage {
    @Override
    public void process(final SuspendedEvent event) {
      event.prepareContinue();
    }
  }

  public static class Stop extends StepMessage {
    @Override
    public void process(final SuspendedEvent event) {
      event.prepareKill();
    }
  }
}
