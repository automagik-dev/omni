# GetMetrics200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**gauges** | **Dict[str, float]** |  | [optional] 
**counters** | **Dict[str, float]** |  | [optional] 
**histograms** | **Dict[str, Optional[object]]** |  | [optional] 

## Example

```python
from omni_generated.models.get_metrics200_response import GetMetrics200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetMetrics200Response from a JSON string
get_metrics200_response_instance = GetMetrics200Response.from_json(json)
# print the JSON string representation of the object
print(GetMetrics200Response.to_json())

# convert the object into a dict
get_metrics200_response_dict = get_metrics200_response_instance.to_dict()
# create an instance of GetMetrics200Response from a dict
get_metrics200_response_from_dict = GetMetrics200Response.from_dict(get_metrics200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


