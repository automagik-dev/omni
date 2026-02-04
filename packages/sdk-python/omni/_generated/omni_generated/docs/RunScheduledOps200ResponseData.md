# RunScheduledOps200ResponseData


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**dead_letter_retry** | [**RunScheduledOps200ResponseDataDeadLetterRetry**](RunScheduledOps200ResponseDataDeadLetterRetry.md) |  | 
**payload_cleanup** | [**RunScheduledOps200ResponseDataPayloadCleanup**](RunScheduledOps200ResponseDataPayloadCleanup.md) |  | 

## Example

```python
from omni_generated.models.run_scheduled_ops200_response_data import RunScheduledOps200ResponseData

# TODO update the JSON string below
json = "{}"
# create an instance of RunScheduledOps200ResponseData from a JSON string
run_scheduled_ops200_response_data_instance = RunScheduledOps200ResponseData.from_json(json)
# print the JSON string representation of the object
print(RunScheduledOps200ResponseData.to_json())

# convert the object into a dict
run_scheduled_ops200_response_data_dict = run_scheduled_ops200_response_data_instance.to_dict()
# create an instance of RunScheduledOps200ResponseData from a dict
run_scheduled_ops200_response_data_from_dict = RunScheduledOps200ResponseData.from_dict(run_scheduled_ops200_response_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


