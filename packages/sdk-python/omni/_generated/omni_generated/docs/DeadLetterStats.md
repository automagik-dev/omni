# DeadLetterStats


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**total** | **int** | Total count | 
**pending** | **int** | Pending count | 
**retrying** | **int** | Retrying count | 
**resolved** | **int** | Resolved count | 
**abandoned** | **int** | Abandoned count | 
**by_event_type** | **Dict[str, float]** | Count by event type | 

## Example

```python
from omni_generated.models.dead_letter_stats import DeadLetterStats

# TODO update the JSON string below
json = "{}"
# create an instance of DeadLetterStats from a JSON string
dead_letter_stats_instance = DeadLetterStats.from_json(json)
# print the JSON string representation of the object
print(DeadLetterStats.to_json())

# convert the object into a dict
dead_letter_stats_dict = dead_letter_stats_instance.to_dict()
# create an instance of DeadLetterStats from a dict
dead_letter_stats_from_dict = DeadLetterStats.from_dict(dead_letter_stats_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


