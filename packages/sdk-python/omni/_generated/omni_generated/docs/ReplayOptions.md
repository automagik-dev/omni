# ReplayOptions


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**since** | **datetime** | Start date (required) | 
**until** | **datetime** | End date | [optional] 
**event_types** | **List[str]** | Event types to replay | [optional] 
**instance_id** | **UUID** | Filter by instance | [optional] 
**limit** | **int** | Max events | [optional] 
**speed_multiplier** | **float** | Replay speed | [optional] 
**skip_processed** | **bool** | Skip already processed | [optional] 
**dry_run** | **bool** | Dry run mode | [optional] 

## Example

```python
from omni_generated.models.replay_options import ReplayOptions

# TODO update the JSON string below
json = "{}"
# create an instance of ReplayOptions from a JSON string
replay_options_instance = ReplayOptions.from_json(json)
# print the JSON string representation of the object
print(ReplayOptions.to_json())

# convert the object into a dict
replay_options_dict = replay_options_instance.to_dict()
# create an instance of ReplayOptions from a dict
replay_options_from_dict = ReplayOptions.from_dict(replay_options_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


