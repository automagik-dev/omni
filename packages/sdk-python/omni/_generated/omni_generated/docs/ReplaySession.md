# ReplaySession


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** | Session UUID | 
**status** | **str** | Status | 
**options** | [**ListReplaySessions200ResponseItemsInnerOptions**](ListReplaySessions200ResponseItemsInnerOptions.md) |  | 
**progress** | [**ListReplaySessions200ResponseItemsInnerProgress**](ListReplaySessions200ResponseItemsInnerProgress.md) |  | 

## Example

```python
from omni_generated.models.replay_session import ReplaySession

# TODO update the JSON string below
json = "{}"
# create an instance of ReplaySession from a JSON string
replay_session_instance = ReplaySession.from_json(json)
# print the JSON string representation of the object
print(ReplaySession.to_json())

# convert the object into a dict
replay_session_dict = replay_session_instance.to_dict()
# create an instance of ReplaySession from a dict
replay_session_from_dict = ReplaySession.from_dict(replay_session_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


