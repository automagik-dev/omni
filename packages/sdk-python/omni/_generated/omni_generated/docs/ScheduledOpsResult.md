# ScheduledOpsResult


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**dead_letter_retry** | [**RunScheduledOps200ResponseDataDeadLetterRetry**](RunScheduledOps200ResponseDataDeadLetterRetry.md) |  | 
**payload_cleanup** | [**RunScheduledOps200ResponseDataPayloadCleanup**](RunScheduledOps200ResponseDataPayloadCleanup.md) |  | 

## Example

```python
from omni_generated.models.scheduled_ops_result import ScheduledOpsResult

# TODO update the JSON string below
json = "{}"
# create an instance of ScheduledOpsResult from a JSON string
scheduled_ops_result_instance = ScheduledOpsResult.from_json(json)
# print the JSON string representation of the object
print(ScheduledOpsResult.to_json())

# convert the object into a dict
scheduled_ops_result_dict = scheduled_ops_result_instance.to_dict()
# create an instance of ScheduledOpsResult from a dict
scheduled_ops_result_from_dict = ScheduledOpsResult.from_dict(scheduled_ops_result_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


