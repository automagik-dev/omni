# PayloadStats


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**total_payloads** | **int** | Total payloads | 
**total_size_bytes** | **int** | Total size | 
**by_stage** | [**GetPayloadStats200ResponseDataByStage**](GetPayloadStats200ResponseDataByStage.md) |  | 
**oldest_payload** | **datetime** | Oldest payload date | 

## Example

```python
from omni_generated.models.payload_stats import PayloadStats

# TODO update the JSON string below
json = "{}"
# create an instance of PayloadStats from a JSON string
payload_stats_instance = PayloadStats.from_json(json)
# print the JSON string representation of the object
print(PayloadStats.to_json())

# convert the object into a dict
payload_stats_dict = payload_stats_instance.to_dict()
# create an instance of PayloadStats from a dict
payload_stats_from_dict = PayloadStats.from_dict(payload_stats_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


