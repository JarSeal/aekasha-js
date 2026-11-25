import { PhysicsProtocolType } from '../protocol/PhysicsProtocolType';
import type { PhysicsWorkerReply } from '../protocol/PhysicsDownProtocol';
import type { PhysicsUpProtocol } from '../protocol/PhysicsUpProtocol';
import type { EngineAPIType } from '../types/PhysicsBackendTypes';

const sendNoJointErrorMessage = (sendMessage: PhysicsWorkerReply, data: PhysicsUpProtocol) =>
  sendMessage(
    {
      type: PhysicsProtocolType.ERROR,
      message: `Could not find MultibodyJointAPI in worker (physicsSwitchMultibodyJoint) for ID: ${'multibodyJointId' in data ? data.multibodyJointId : undefined}`,
    },
    data
  );

/**
 * The worker's switch for the multibody joints' messages (1000-1199, p250): the create and the
 * delete, and each getter and setter of one joint by id. An unknown joint id replies `ERROR`; a
 * throw (the create's refusals) reaches `PhysicsWorker.ts`' catch, which does the same with the
 * request's id.
 * @internal
 * @param data the message, already routed here by its type's range
 * @param engAPI the backend
 * @param sendMessage the worker's reply, sent through its transport
 */
export const physicsSwitchMultibodyJoint = (
  data: PhysicsUpProtocol,
  engAPI: EngineAPIType,
  sendMessage: PhysicsWorkerReply
) => {
  const jointAPI =
    'multibodyJointId' in data
      ? engAPI.getMultibodyJointAPIWithId(data.multibodyJointId)
      : undefined;

  switch (data.type) {
    case PhysicsProtocolType.CREATE_MULTIBODY_JOINT: {
      const joint = engAPI.createMultibodyJoint(data.params);
      return sendMessage({ type: data.type, id: joint.id }, data);
    }

    case PhysicsProtocolType.DELETE_MULTIBODY_JOINT: {
      return sendMessage(
        { type: data.type, ...engAPI.deleteMultibodyJoint(data.id, data.wakeUp) },
        data
      );
    }

    case PhysicsProtocolType.MULTIBODY_JOINT_GET_USERDATA: {
      if (!jointAPI) return sendNoJointErrorMessage(sendMessage, data);
      return sendMessage({ type: data.type, userData: jointAPI.getUserDataSync() }, data);
    }

    case PhysicsProtocolType.MULTIBODY_JOINT_SET_USERDATA: {
      if (!jointAPI) return sendNoJointErrorMessage(sendMessage, data);
      return jointAPI.setUserData(data.userData, data.addToExisting);
    }

    case PhysicsProtocolType.MULTIBODY_JOINT_IS_VALID: {
      if (!jointAPI) return sendNoJointErrorMessage(sendMessage, data);
      return sendMessage({ type: data.type, isValid: jointAPI.isValidSync() }, data);
    }

    case PhysicsProtocolType.MULTIBODY_JOINT_CONTACTS_ENABLED: {
      if (!jointAPI) return sendNoJointErrorMessage(sendMessage, data);
      return sendMessage(
        { type: data.type, contactsEnabled: jointAPI.contactsEnabledSync() },
        data
      );
    }

    case PhysicsProtocolType.MULTIBODY_JOINT_SET_CONTACTS_ENABLED: {
      if (!jointAPI) return sendNoJointErrorMessage(sendMessage, data);
      return jointAPI.setContactsEnabled(data.enabled);
    }

    default:
      sendMessage(
        {
          type: PhysicsProtocolType.ERROR,
          message: `Unknown physics worker (up) protocol type: ${data.type} (in MULTIBODY_JOINT sub type)`,
        },
        data
      );
  }
};
